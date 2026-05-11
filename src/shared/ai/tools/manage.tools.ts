import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import { AiTool, ToolContext } from './tool.interface';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../database/repositories/surgery-request-activity.repository';
import { SurgeryRequestTussItemRepository } from '../../../database/repositories/surgery-request-tuss-item.repository';
import { OpmeItemRepository } from '../../../database/repositories/opme-item.repository';
import { DocumentRepository } from '../../../database/repositories/document.repository';
import { SupplierRepository } from '../../../database/repositories/supplier.repository';
import { HealthPlanRepository } from '../../../database/repositories/health-plan.repository';
import { SurgeryRequestsService } from '../../../modules/surgery-requests/surgery-requests.service';
import { ActivityType } from '../../../database/entities/surgery-request-activity.entity';
import { SurgeryRequestStatus } from '../../../database/entities/surgery-request.entity';
import { StorageService } from '../../storage/storage.service';
import { STORAGE_FOLDERS } from '../../../config/storage.config';
import { DOCUMENT_KEYS } from '../../constants/document-keys';
import { detokenizeArg, tokenizePii } from '../pii/tool-pii-helpers';
import { buildProtocolCandidates } from './protocol.helpers';

const REPORT_IMAGE_KEY = DOCUMENT_KEYS.REPORT_IMAGES;
const REPORT_IMAGE_TYPE = 'exam_image';

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function asPositiveInt(value: unknown, fallback = 1): number {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    Number.isInteger(value)
  ) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => asNonEmptyString(item))
      .filter((item): item is string => Boolean(item));
  }

  const single = asNonEmptyString(value);
  if (!single) return [];

  return single
    .split(/[\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sanitizeIdentifier(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/[\s.,;:!?]+$/g, '');
}

function sanitizeAlphaNumKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

function classifyDocumentType(
  contentType: string | null | undefined,
  providedType: unknown,
): string {
  const typed = asNonEmptyString(providedType);
  if (typed) return typed;

  const mime = (contentType || '').toLowerCase();
  if (mime.includes('pdf')) return 'medical_report';
  if (mime.startsWith('image/')) return 'exam_image';
  if (mime.includes('word') || mime.includes('officedocument')) {
    return 'report_document';
  }
  return 'other_document';
}

async function downloadInboundMedia(
  url: string,
  configService?: ConfigService,
): Promise<{ buffer: Buffer; contentType: string | null; fileName: string }> {
  const sid = configService?.get<string>('TWILIO_ACCOUNT_SID', '') || '';
  const token = configService?.get<string>('TWILIO_AUTH_TOKEN', '') || '';

  const headers: Record<string, string> = {};
  if (sid && token) {
    headers.Authorization = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`falha no download da mídia (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get('content-type');
  const urlPath = new URL(url).pathname;
  const fileNameFallback = urlPath.split('/').pop() || `media-${Date.now()}`;

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType,
    fileName: fileNameFallback,
  };
}

async function getAuthorizedRequest(
  surgeryRequestRepo: SurgeryRequestRepository,
  surgeryRequestId: unknown,
  context: ToolContext,
): Promise<
  | { ok: false; message: string; request: null }
  | { ok: true; message: string; request: any }
> {
  if (!context.userId) {
    return { ok: false, message: 'Acesso negado.', request: null };
  }

  const detokenized = detokenizeArg(context, surgeryRequestId as any);
  const identifier = sanitizeIdentifier(detokenized ?? surgeryRequestId);
  if (!identifier) {
    return {
      ok: false,
      message: 'Parâmetro inválido: informe `surgeryRequestId` válido.',
      request: null,
    };
  }

  let request = null;
  if (identifier.match(/^[0-9a-f-]{36}$/i)) {
    request = await surgeryRequestRepo.findOneSimple({ id: identifier });
  }

  if (!request) {
    for (const candidate of buildProtocolCandidates(identifier)) {
      request = await surgeryRequestRepo.findOneSimple({ protocol: candidate });
      if (request) break;
    }
  }

  if (!request) {
    return {
      ok: false,
      message: 'Solicitação não encontrada.',
      request: null,
    };
  }

  if (!context.accessibleDoctorIds.includes(request.doctorId)) {
    return {
      ok: false,
      message: 'Você não tem permissão para acessar essa solicitação.',
      request: null,
    };
  }

  return { ok: true, message: '', request };
}

function formatStatusLabel(status: number | null | undefined): string {
  switch (status) {
    case 1:
      return 'Pendente';
    case 2:
      return 'Enviada';
    case 3:
      return 'Em Análise';
    case 4:
      return 'Em Agendamento';
    case 5:
      return 'Agendada';
    case 6:
      return 'Realizada';
    case 7:
      return 'Faturada';
    case 8:
      return 'Finalizada';
    case 9:
      return 'Encerrada';
    default:
      return String(status ?? 'Desconhecido');
  }
}

function ensurePendingForMutation(request: any): string | null {
  if (request?.status !== SurgeryRequestStatus.PENDING) {
    return `Não é possível alterar essas informações: a solicitação está em "${formatStatusLabel(
      request?.status,
    )}". A partir de "Enviada" os dados ficam apenas como histórico (somente leitura).`;
  }
  return null;
}

export function buildManageTools(
  surgeryRequestRepo: SurgeryRequestRepository,
  surgeryRequestsService: SurgeryRequestsService,
  activityRepo: SurgeryRequestActivityRepository,
  tussItemRepo: SurgeryRequestTussItemRepository,
  opmeItemRepo: OpmeItemRepository,
  documentRepo: DocumentRepository,
  supplierRepo: SupplierRepository,
  healthPlanRepo: HealthPlanRepository,
  storageService: StorageService,
  configService: ConfigService,
): AiTool[] {
  // ────────────────────────────────────────────────────────────────────────
  // manage_tuss_items
  // ────────────────────────────────────────────────────────────────────────
  const manageTussItems: AiTool = {
    name: 'manage_tuss_items',
    definition: {
      type: 'function',
      function: {
        name: 'manage_tuss_items',
        description:
          'Gerencia itens TUSS de uma solicitação cirúrgica: list (consultar), add (adicionar), update (editar quantidade ou nome) e remove (excluir). Mutações exigem confirm=true. Remoção só é permitida quando a SC está no status Pendente.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description:
                'ID/Protocolo da solicitação (UUID, SC-XXXX ou número).',
            },
            operation: {
              type: 'string',
              description: 'Operação: list, add, update ou remove.',
            },
            tussItemId: {
              type: 'string',
              description: 'ID do item TUSS (obrigatório em update e remove).',
            },
            tussCode: {
              type: 'string',
              description:
                'Código TUSS (obrigatório em add; opcional em update).',
            },
            name: {
              type: 'string',
              description:
                'Nome do procedimento (obrigatório em add; opcional em update).',
            },
            quantity: {
              type: 'number',
              description: 'Quantidade do item (opcional em add e update).',
            },
            confirm: {
              type: 'boolean',
              description:
                'Obrigatório (true) para executar mutações; em list é ignorado.',
            },
          },
          required: ['surgeryRequestId', 'operation'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;

      const operation = asNonEmptyString(args.operation)?.toLowerCase();
      if (
        !operation ||
        !['list', 'add', 'update', 'remove'].includes(operation)
      ) {
        return 'Parâmetro inválido: `operation` deve ser list, add, update ou remove.';
      }

      const protocolToken = tokenizePii(
        context,
        'manage_tuss_items',
        'protocol',
        auth.request.protocol,
      );

      if (operation === 'list') {
        const items = await tussItemRepo.findMany({
          surgeryRequestId: auth.request.id,
        } as any);
        if (!items.length) {
          return `Nenhum item TUSS cadastrado para a solicitação SC-${protocolToken}.`;
        }
        const lines = items.map(
          (item: any, index: number) =>
            `${index + 1}. ${item.tussCode} — ${item.name} (qtd: ${item.quantity})\n   id: ${item.id}`,
        );
        return [
          `Itens TUSS da solicitação SC-${protocolToken}:`,
          ...lines,
        ].join('\n');
      }

      if (operation === 'add') {
        const blockedAdd = ensurePendingForMutation(auth.request);
        if (blockedAdd) return blockedAdd;

        const tussCode = asNonEmptyString(args.tussCode);
        const name = asNonEmptyString(args.name);
        const quantity = asPositiveInt(args.quantity, 1);

        if (!tussCode || !name) {
          return 'Para adicionar TUSS, informe `tussCode` e `name`.';
        }

        if (!args.confirm) {
          return `A solicitação SC-${protocolToken} receberá o item TUSS ${tussCode} (${name}), quantidade ${quantity}. Confirme com "sim" para executar.`;
        }

        const created = await tussItemRepo.create({
          surgeryRequestId: auth.request.id,
          tussCode,
          name,
          quantity,
        } as any);

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Item TUSS adicionado: ${tussCode} - ${name} (qtd: ${quantity}).`,
        });

        return `Item TUSS ${tussCode} adicionado com sucesso (id: ${created.id}).`;
      }

      const tussItemId = asNonEmptyString(args.tussItemId);
      if (!tussItemId) {
        return `Para ${operation}, informe \`tussItemId\`.`;
      }

      const item = await tussItemRepo.findOne({
        id: tussItemId,
        surgeryRequestId: auth.request.id,
      } as any);
      if (!item) {
        return 'Item TUSS não encontrado para essa solicitação.';
      }

      if (operation === 'update') {
        const blockedUpdate = ensurePendingForMutation(auth.request);
        if (blockedUpdate) return blockedUpdate;

        const updates: Record<string, any> = {};
        const changes: string[] = [];

        const newCode = asNonEmptyString(args.tussCode);
        if (newCode && newCode !== item.tussCode) {
          updates.tussCode = newCode;
          changes.push(`código: ${newCode}`);
        }

        const newName = asNonEmptyString(args.name);
        if (newName && newName !== item.name) {
          updates.name = newName;
          changes.push(`nome: ${newName}`);
        }

        if (args.quantity !== undefined) {
          const q = asPositiveInt(args.quantity, item.quantity);
          if (q !== item.quantity) {
            updates.quantity = q;
            changes.push(`quantidade: ${q}`);
          }
        }

        if (!changes.length) {
          return 'Nenhuma alteração informada.';
        }

        if (!args.confirm) {
          return `O item TUSS ${item.tussCode} terá: ${changes.join(', ')}. Confirme com "sim" para executar.`;
        }

        await tussItemRepo.update(tussItemId, updates as any);

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Item TUSS ${item.tussCode} atualizado (${changes.join(', ')}).`,
        });

        return `Item TUSS atualizado com sucesso.`;
      }

      // remove
      const blocked = ensurePendingForMutation(auth.request);
      if (blocked) return blocked;

      if (!args.confirm) {
        return `O item TUSS ${item.tussCode} (${item.name}) será removido da solicitação SC-${protocolToken}. Confirme com "sim" para executar.`;
      }

      await tussItemRepo.getRepository().delete({ id: tussItemId });

      await activityRepo.create({
        surgeryRequestId: auth.request.id,
        userId: context.userId as string,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Item TUSS removido: ${item.tussCode} (${item.name}).`,
      });

      return `Item TUSS ${item.tussCode} removido com sucesso.`;
    },
  };

  // ────────────────────────────────────────────────────────────────────────
  // manage_opme_items
  // ────────────────────────────────────────────────────────────────────────
  const manageOpmeItems: AiTool = {
    name: 'manage_opme_items',
    definition: {
      type: 'function',
      function: {
        name: 'manage_opme_items',
        description:
          'Gerencia itens OPME de uma solicitação cirúrgica: list (consultar), add (adicionar — exige ao menos 3 fabricantes e 3 fornecedores), update (editar nome, quantidade, fabricantes e fornecedores) e remove (excluir). Mutações exigem confirm=true. Remoção só é permitida quando a SC está no status Pendente.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description:
                'ID/Protocolo da solicitação (UUID, SC-XXXX ou número).',
            },
            operation: {
              type: 'string',
              description: 'Operação: list, add, update ou remove.',
            },
            opmeItemId: {
              type: 'string',
              description: 'ID do item OPME (obrigatório em update e remove).',
            },
            name: {
              type: 'string',
              description: 'Nome do item OPME (obrigatório em add).',
            },
            quantity: {
              type: 'number',
              description: 'Quantidade (opcional em add e update).',
            },
            manufacturerNames: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Lista com ao menos 3 fabricantes (obrigatório em add; opcional em update).',
            },
            supplierNames: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Lista com ao menos 3 fornecedores (obrigatório em add; opcional em update).',
            },
            confirm: {
              type: 'boolean',
              description:
                'Obrigatório (true) para executar mutações; em list é ignorado.',
            },
          },
          required: ['surgeryRequestId', 'operation'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;

      const operation = asNonEmptyString(args.operation)?.toLowerCase();
      if (
        !operation ||
        !['list', 'add', 'update', 'remove'].includes(operation)
      ) {
        return 'Parâmetro inválido: `operation` deve ser list, add, update ou remove.';
      }

      const protocolToken = tokenizePii(
        context,
        'manage_opme_items',
        'protocol',
        auth.request.protocol,
      );

      if (operation === 'list') {
        const items = await opmeItemRepo.getRepository().find({
          where: { surgeryRequestId: auth.request.id } as any,
          relations: ['suppliers'],
        });

        if (!items.length) {
          return `Nenhum item OPME cadastrado para a solicitação SC-${protocolToken}.`;
        }

        const lines = items.map((item: any, index: number) => {
          const suppliers = (item.suppliers || [])
            .map((s: any) => s.name)
            .filter(Boolean)
            .join(', ');
          return [
            `${index + 1}. ${item.name} (qtd: ${item.quantity})`,
            `   Fabricantes: ${item.brand || 'não informado'}`,
            `   Fornecedores: ${suppliers || 'não informados'}`,
            `   id: ${item.id}`,
          ].join('\n');
        });

        return [
          `Itens OPME da solicitação SC-${protocolToken}:`,
          ...lines,
        ].join('\n');
      }

      if (operation === 'add') {
        const blockedAdd = ensurePendingForMutation(auth.request);
        if (blockedAdd) return blockedAdd;

        const name = asNonEmptyString(args.name);
        const manufacturerNames = parseStringList(args.manufacturerNames);
        const supplierNames = parseStringList(args.supplierNames);
        const quantity = asPositiveInt(args.quantity, 1);

        if (!name) {
          return 'Para adicionar OPME, informe `name`.';
        }
        if (manufacturerNames.length < 3) {
          return 'Para adicionar OPME, informe ao menos 3 fabricantes em `manufacturerNames`.';
        }
        if (supplierNames.length < 3) {
          return 'Para adicionar OPME, informe ao menos 3 fornecedores em `supplierNames`.';
        }

        if (!args.confirm) {
          return `A solicitação SC-${protocolToken} receberá item OPME ${name}, quantidade ${quantity}, com ${manufacturerNames.length} fabricantes e ${supplierNames.length} fornecedores. Confirme com "sim" para executar.`;
        }

        const suppliers: any[] = [];
        for (const supplierName of supplierNames) {
          const found = await supplierRepo.findMany(
            {
              ownerId: auth.request.ownerId,
              name: supplierName,
            } as any,
            0,
            1,
          );
          if (found.length > 0) {
            suppliers.push(found[0]);
            continue;
          }
          const created = await supplierRepo.create({
            ownerId: auth.request.ownerId,
            name: supplierName,
            active: true,
          } as any);
          suppliers.push(created);
        }

        await surgeryRequestsService.setHasOpme(
          auth.request.id,
          true,
          context.userId as string,
        );

        const entity = opmeItemRepo.getRepository().create({
          surgeryRequestId: auth.request.id,
          name,
          brand: manufacturerNames.join(', '),
          quantity,
          suppliers,
        } as any);
        const saved = await opmeItemRepo.getRepository().save(entity);

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Item OPME adicionado: ${name}, qtd ${quantity}, ${manufacturerNames.length} fabricantes, ${supplierNames.length} fornecedores.`,
        });

        return `Item OPME ${name} adicionado com sucesso (id: ${(saved as any).id}).`;
      }

      const opmeItemId = asNonEmptyString(args.opmeItemId);
      if (!opmeItemId) {
        return `Para ${operation}, informe \`opmeItemId\`.`;
      }

      const item = await opmeItemRepo.findByIdWithSuppliers(opmeItemId);
      if (!item || item.surgeryRequestId !== auth.request.id) {
        return 'Item OPME não encontrado para essa solicitação.';
      }

      if (operation === 'update') {
        const blockedUpdate = ensurePendingForMutation(auth.request);
        if (blockedUpdate) return blockedUpdate;

        const changes: string[] = [];

        const newName = asNonEmptyString(args.name);
        if (newName && newName !== item.name) {
          item.name = newName;
          changes.push(`nome: ${newName}`);
        }

        if (args.quantity !== undefined) {
          const q = asPositiveInt(args.quantity, item.quantity);
          if (q !== item.quantity) {
            item.quantity = q;
            changes.push(`quantidade: ${q}`);
          }
        }

        if (args.manufacturerNames !== undefined) {
          const manufacturers = parseStringList(args.manufacturerNames);
          if (manufacturers.length < 3) {
            return 'Para atualizar fabricantes, informe ao menos 3 em `manufacturerNames`.';
          }
          const joined = manufacturers.join(', ');
          if (joined !== item.brand) {
            item.brand = joined;
            changes.push(`fabricantes: ${manufacturers.length} itens`);
          }
        }

        if (args.supplierNames !== undefined) {
          const supplierNames = parseStringList(args.supplierNames);
          if (supplierNames.length < 3) {
            return 'Para atualizar fornecedores, informe ao menos 3 em `supplierNames`.';
          }

          const suppliers: any[] = [];
          for (const supplierName of supplierNames) {
            const found = await supplierRepo.findMany(
              {
                ownerId: auth.request.ownerId,
                name: supplierName,
              } as any,
              0,
              1,
            );
            if (found.length > 0) {
              suppliers.push(found[0]);
              continue;
            }
            const created = await supplierRepo.create({
              ownerId: auth.request.ownerId,
              name: supplierName,
              active: true,
            } as any);
            suppliers.push(created);
          }

          item.suppliers = suppliers;
          changes.push(`fornecedores: ${supplierNames.length} itens`);
        }

        if (!changes.length) {
          return 'Nenhuma alteração informada.';
        }

        if (!args.confirm) {
          return `O item OPME ${item.name} terá: ${changes.join(', ')}. Confirme com "sim" para executar.`;
        }

        await opmeItemRepo.saveWithSuppliers(item);

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Item OPME ${item.name} atualizado (${changes.join(', ')}).`,
        });

        return `Item OPME atualizado com sucesso.`;
      }

      // remove
      const blocked = ensurePendingForMutation(auth.request);
      if (blocked) return blocked;

      if (!args.confirm) {
        return `O item OPME ${item.name} será removido da solicitação SC-${protocolToken}. Confirme com "sim" para executar.`;
      }

      // Limpa associação com fornecedores antes de remover (mesmo padrão do OpmeService).
      item.suppliers = [];
      await opmeItemRepo.saveWithSuppliers(item);
      await opmeItemRepo.getRepository().remove(item);

      await activityRepo.create({
        surgeryRequestId: auth.request.id,
        userId: context.userId as string,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Item OPME removido: ${item.name}.`,
      });

      return `Item OPME ${item.name} removido com sucesso.`;
    },
  };

  // ────────────────────────────────────────────────────────────────────────
  // manage_documents
  // ────────────────────────────────────────────────────────────────────────
  const manageDocuments: AiTool = {
    name: 'manage_documents',
    definition: {
      type: 'function',
      function: {
        name: 'manage_documents',
        description:
          'Gerencia documentos da solicitação cirúrgica: list (lista os documentos anexados, exceto imagens do laudo), attach (anexa o arquivo recebido pelo WhatsApp como documento) e remove (exclui). Mutações exigem confirm=true.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description:
                'ID/Protocolo da solicitação (UUID, SC-XXXX ou número).',
            },
            operation: {
              type: 'string',
              description: 'Operação: list, attach ou remove.',
            },
            documentId: {
              type: 'string',
              description: 'ID do documento (obrigatório em remove).',
            },
            documentType: {
              type: 'string',
              description:
                'Tipo do documento (opcional em attach; ex.: medical_report, exam_report, surgery_room).',
            },
            documentName: {
              type: 'string',
              description: 'Nome amigável do documento (opcional em attach).',
            },
            documentKey: {
              type: 'string',
              description:
                'Chave técnica do documento (opcional em attach; gerada automaticamente se omitida).',
            },
            mediaIndex: {
              type: 'number',
              description:
                'Índice da mídia recebida no WhatsApp quando há mais de uma (opcional em attach; padrão 0).',
            },
            confirm: {
              type: 'boolean',
              description:
                'Obrigatório (true) para executar mutações; em list é ignorado.',
            },
          },
          required: ['surgeryRequestId', 'operation'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;

      const operation = asNonEmptyString(args.operation)?.toLowerCase();
      if (!operation || !['list', 'attach', 'remove'].includes(operation)) {
        return 'Parâmetro inválido: `operation` deve ser list, attach ou remove.';
      }

      const protocolToken = tokenizePii(
        context,
        'manage_documents',
        'protocol',
        auth.request.protocol,
      );

      if (operation === 'list') {
        const docs = await documentRepo.findMany({
          surgeryRequestId: auth.request.id,
        } as any);
        const filtered = docs.filter((d: any) => d.key !== REPORT_IMAGE_KEY);
        if (!filtered.length) {
          return `Nenhum documento anexado à solicitação SC-${protocolToken}.`;
        }
        const lines = filtered.map((d: any, index: number) => {
          const date = d.createdAt
            ? new Date(d.createdAt).toLocaleDateString('pt-BR')
            : '';
          return `${index + 1}. ${d.name || d.key} (tipo: ${d.type || 'n/d'}${date ? `, ${date}` : ''})\n   id: ${d.id}`;
        });
        return [
          `Documentos da solicitação SC-${protocolToken}:`,
          ...lines,
        ].join('\n');
      }

      if (operation === 'attach') {
        const inboundMedia = context.inboundMedia || [];
        if (!inboundMedia.length) {
          return 'Não identifiquei nenhum arquivo nesta mensagem. Envie o documento pelo WhatsApp e tente novamente.';
        }

        const mediaIndex =
          typeof args.mediaIndex === 'number' &&
          Number.isInteger(args.mediaIndex) &&
          args.mediaIndex >= 0 &&
          args.mediaIndex < inboundMedia.length
            ? args.mediaIndex
            : 0;

        const media = inboundMedia[mediaIndex];
        const detectedType = classifyDocumentType(
          media.contentType,
          args.documentType,
        );
        const providedName = asNonEmptyString(args.documentName);
        const computedKey =
          asNonEmptyString(args.documentKey) ||
          sanitizeAlphaNumKey(
            detectedType || providedName || 'documento_whatsapp',
          );
        const computedName =
          providedName ||
          `Documento WhatsApp ${new Date().toLocaleDateString('pt-BR')}`;

        if (!args.confirm) {
          return `Documento identificado para a solicitação SC-${protocolToken}. Tipo: ${detectedType}. Nome: ${computedName}. Confirme com "sim" para anexar.`;
        }

        try {
          const downloaded = await downloadInboundMedia(
            media.url,
            configService,
          );
          const path = await storageService.create(
            {
              originalname: computedName,
              mimetype:
                media.contentType ||
                downloaded.contentType ||
                'application/octet-stream',
              buffer: downloaded.buffer,
            } as any,
            STORAGE_FOLDERS.DOCUMENTS,
          );

          const created = await documentRepo.create({
            surgeryRequestId: auth.request.id,
            createdById: context.userId as string,
            type: detectedType,
            key: computedKey,
            name: computedName,
            uri: path,
          } as any);

          await activityRepo.create({
            surgeryRequestId: auth.request.id,
            userId: context.userId as string,
            type: ActivityType.SYSTEM,
            content: `[WhatsApp IA] Documento anexado: ${computedName} (tipo: ${detectedType}).`,
          });

          return `Documento ${computedName} anexado com sucesso (id: ${(created as any).id}).`;
        } catch (err: any) {
          return `Erro ao anexar documento: ${err?.message || 'erro desconhecido'}`;
        }
      }

      // remove
      const documentId = asNonEmptyString(args.documentId);
      if (!documentId) {
        return 'Para remover, informe `documentId`.';
      }

      const doc = await documentRepo.findOne({
        id: documentId,
        surgeryRequestId: auth.request.id,
      } as any);
      if (!doc) {
        return 'Documento não encontrado para essa solicitação.';
      }

      if (doc.key === REPORT_IMAGE_KEY) {
        return 'Esse arquivo é uma imagem do laudo — use `manage_report_images` para removê-la.';
      }

      if (!args.confirm) {
        return `O documento "${doc.name}" será removido da solicitação SC-${protocolToken}. Confirme com "sim" para executar.`;
      }

      await documentRepo.getRepository().delete({ id: documentId });

      await activityRepo.create({
        surgeryRequestId: auth.request.id,
        userId: context.userId as string,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Documento removido: ${doc.name} (tipo: ${doc.type}).`,
      });

      return `Documento "${doc.name}" removido com sucesso.`;
    },
  };

  // ────────────────────────────────────────────────────────────────────────
  // manage_report_images
  // ────────────────────────────────────────────────────────────────────────
  const manageReportImages: AiTool = {
    name: 'manage_report_images',
    definition: {
      type: 'function',
      function: {
        name: 'manage_report_images',
        description:
          'Gerencia as imagens anexadas ao laudo de uma solicitação cirúrgica: list (consultar), attach (anexa a imagem recebida pelo WhatsApp como imagem do laudo) e remove (excluir). Apenas arquivos do tipo imagem podem ser anexados. Mutações exigem confirm=true.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description:
                'ID/Protocolo da solicitação (UUID, SC-XXXX ou número).',
            },
            operation: {
              type: 'string',
              description: 'Operação: list, attach ou remove.',
            },
            imageId: {
              type: 'string',
              description: 'ID da imagem (obrigatório em remove).',
            },
            mediaIndex: {
              type: 'number',
              description:
                'Índice da mídia recebida no WhatsApp quando há mais de uma (opcional em attach; padrão 0).',
            },
            imageName: {
              type: 'string',
              description: 'Nome amigável da imagem (opcional em attach).',
            },
            confirm: {
              type: 'boolean',
              description:
                'Obrigatório (true) para executar mutações; em list é ignorado.',
            },
          },
          required: ['surgeryRequestId', 'operation'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;

      const operation = asNonEmptyString(args.operation)?.toLowerCase();
      if (!operation || !['list', 'attach', 'remove'].includes(operation)) {
        return 'Parâmetro inválido: `operation` deve ser list, attach ou remove.';
      }

      const protocolToken = tokenizePii(
        context,
        'manage_report_images',
        'protocol',
        auth.request.protocol,
      );

      if (operation === 'list') {
        const all = await documentRepo.findMany({
          surgeryRequestId: auth.request.id,
        } as any);
        const images = all.filter((d: any) => d.key === REPORT_IMAGE_KEY);
        if (!images.length) {
          return `Nenhuma imagem anexada ao laudo da solicitação SC-${protocolToken}.`;
        }
        const lines = images.map((d: any, index: number) => {
          const date = d.createdAt
            ? new Date(d.createdAt).toLocaleDateString('pt-BR')
            : '';
          return `${index + 1}. ${d.name || 'Imagem'}${date ? ` (${date})` : ''}\n   id: ${d.id}`;
        });
        return [
          `Imagens do laudo da solicitação SC-${protocolToken}:`,
          ...lines,
        ].join('\n');
      }

      if (operation === 'attach') {
        const blockedAttach = ensurePendingForMutation(auth.request);
        if (blockedAttach) return blockedAttach;

        const inboundMedia = context.inboundMedia || [];
        if (!inboundMedia.length) {
          return 'Não identifiquei nenhuma imagem nesta mensagem. Envie a imagem pelo WhatsApp e tente novamente.';
        }

        const mediaIndex =
          typeof args.mediaIndex === 'number' &&
          Number.isInteger(args.mediaIndex) &&
          args.mediaIndex >= 0 &&
          args.mediaIndex < inboundMedia.length
            ? args.mediaIndex
            : 0;

        const media = inboundMedia[mediaIndex];
        const mime = (media.contentType || '').toLowerCase();
        if (!mime.startsWith('image/')) {
          return 'O arquivo enviado não é uma imagem. Envie uma foto/imagem (JPG, PNG, etc.) para anexar ao laudo.';
        }

        const providedName = asNonEmptyString(args.imageName);
        const computedName =
          providedName ||
          `Imagem do laudo ${new Date().toLocaleDateString('pt-BR')}`;

        if (!args.confirm) {
          return `A imagem "${computedName}" será anexada ao laudo da solicitação SC-${protocolToken}. Confirme com "sim" para executar.`;
        }

        try {
          const downloaded = await downloadInboundMedia(
            media.url,
            configService,
          );
          const path = await storageService.create(
            {
              originalname: computedName,
              mimetype:
                media.contentType || downloaded.contentType || 'image/jpeg',
              buffer: downloaded.buffer,
            } as any,
            STORAGE_FOLDERS.DOCUMENTS,
          );

          const created = await documentRepo.create({
            surgeryRequestId: auth.request.id,
            createdById: context.userId as string,
            type: REPORT_IMAGE_TYPE,
            key: REPORT_IMAGE_KEY,
            name: computedName,
            uri: path,
          } as any);

          await activityRepo.create({
            surgeryRequestId: auth.request.id,
            userId: context.userId as string,
            type: ActivityType.SYSTEM,
            content: `[WhatsApp IA] Imagem anexada ao laudo: ${computedName}.`,
          });

          return `Imagem "${computedName}" anexada ao laudo com sucesso (id: ${(created as any).id}).`;
        } catch (err: any) {
          return `Erro ao anexar imagem: ${err?.message || 'erro desconhecido'}`;
        }
      }

      // remove
      const blockedRemove = ensurePendingForMutation(auth.request);
      if (blockedRemove) return blockedRemove;

      const imageId = asNonEmptyString(args.imageId);
      if (!imageId) {
        return 'Para remover, informe `imageId`.';
      }

      const doc = await documentRepo.findOne({
        id: imageId,
        surgeryRequestId: auth.request.id,
      } as any);
      if (!doc || doc.key !== REPORT_IMAGE_KEY) {
        return 'Imagem do laudo não encontrada para essa solicitação.';
      }

      if (!args.confirm) {
        return `A imagem "${doc.name}" será removida do laudo da solicitação SC-${protocolToken}. Confirme com "sim" para executar.`;
      }

      await documentRepo.getRepository().delete({ id: imageId });

      await activityRepo.create({
        surgeryRequestId: auth.request.id,
        userId: context.userId as string,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Imagem removida do laudo: ${doc.name}.`,
      });

      return `Imagem "${doc.name}" removida do laudo com sucesso.`;
    },
  };

  // ────────────────────────────────────────────────────────────────────────
  // set_health_plan
  // ────────────────────────────────────────────────────────────────────────
  const setHealthPlan: AiTool = {
    name: 'set_health_plan',
    definition: {
      type: 'function',
      function: {
        name: 'set_health_plan',
        description:
          'Define, troca ou remove o convênio (plano de saúde) vinculado à solicitação. Aceita `healthPlanId` ou `health_plan_name`. Para remover, use `clear=true`. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description:
                'ID/Protocolo da solicitação (UUID, SC-XXXX ou número).',
            },
            healthPlanId: {
              type: 'string',
              description: 'ID do convênio já cadastrado.',
            },
            health_plan_name: {
              type: 'string',
              description: 'Nome exato do convênio cadastrado na clínica.',
            },
            clear: {
              type: 'boolean',
              description: 'Se true, remove o convênio vinculado à SC.',
            },
            confirm: {
              type: 'boolean',
              description: 'Obrigatório (true) para executar a mutação.',
            },
          },
          required: ['surgeryRequestId'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;

      const protocolToken = tokenizePii(
        context,
        'set_health_plan',
        'protocol',
        auth.request.protocol,
      );

      const blocked = ensurePendingForMutation(auth.request);
      if (blocked) return blocked;

      if (args.clear === true) {
        if (!args.confirm) {
          return `O convênio será removido da solicitação SC-${protocolToken}. Confirme com "sim" para executar.`;
        }
        await surgeryRequestRepo.update(auth.request.id, {
          healthPlanId: null,
        } as any);
        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: '[WhatsApp IA] Convênio removido da solicitação.',
        });
        return `Convênio removido com sucesso da solicitação SC-${protocolToken}.`;
      }

      const healthPlanId = asNonEmptyString(args.healthPlanId);
      const healthPlanName = asNonEmptyString(
        detokenizeArg(context, args.health_plan_name),
      );

      if (!healthPlanId && !healthPlanName) {
        return 'Para definir o convênio, informe `healthPlanId` ou `health_plan_name`. Para remover, use `clear=true`.';
      }

      let selected: any = null;
      if (healthPlanId) {
        selected = await healthPlanRepo.findOne({
          id: healthPlanId,
          ownerId: auth.request.ownerId,
        } as any);
        if (!selected) {
          return 'Convênio não encontrado para essa clínica. Verifique o `healthPlanId`.';
        }
      } else if (healthPlanName) {
        selected = await healthPlanRepo.findOne({
          name: healthPlanName,
          ownerId: auth.request.ownerId,
        } as any);
        if (!selected) {
          return `Convênio "${healthPlanName}" não encontrado para essa clínica. Cadastre-o antes ou informe o \`healthPlanId\`.`;
        }
      }

      const previewName = tokenizePii(
        context,
        'set_health_plan',
        'health_plan_name',
        selected.name,
      );

      if (!args.confirm) {
        return `A solicitação SC-${protocolToken} terá o convênio atualizado para ${previewName}. Confirme com "sim" para executar.`;
      }

      await surgeryRequestRepo.update(auth.request.id, {
        healthPlanId: selected.id,
      } as any);

      await activityRepo.create({
        surgeryRequestId: auth.request.id,
        userId: context.userId as string,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Convênio definido para ${selected.name}.`,
      });

      return `Convênio atualizado com sucesso para ${previewName} na solicitação SC-${protocolToken}.`;
    },
  };

  return [
    manageTussItems,
    manageOpmeItems,
    manageDocuments,
    manageReportImages,
    setHealthPlan,
  ];
}
