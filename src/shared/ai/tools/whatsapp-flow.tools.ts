import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../database/repositories/surgery-request-activity.repository';
import { SurgeryRequestWorkflowService } from '../../../modules/surgery-requests/services/surgery-request-workflow.service';
import { SurgeryRequestsService } from '../../../modules/surgery-requests/surgery-requests.service';
import { ActivityType } from '../../../database/entities/surgery-request-activity.entity';
import { SendMethod } from '../../constants/send-method';
import { PatientRepository } from '../../../database/repositories/patient.repository';
import { HospitalRepository } from '../../../database/repositories/hospital.repository';
import { HealthPlanRepository } from '../../../database/repositories/health-plan.repository';
import { ProcedureRepository } from '../../../database/repositories/procedure.repository';
import { UserRepository } from '../../../database/repositories/user.repository';
import { SurgeryRequestTussItemRepository } from '../../../database/repositories/surgery-request-tuss-item.repository';
import { OpmeItemRepository } from '../../../database/repositories/opme-item.repository';
import { DocumentRepository } from '../../../database/repositories/document.repository';
import { StorageService } from '../../storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { STORAGE_FOLDERS } from '../../../config/storage.config';
import { SurgeryRequestPriority } from '../../../database/entities/surgery-request.entity';
import { In } from 'typeorm';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { TussService } from '../../../modules/tuss/tuss.service';
import { SupplierRepository } from '../../../database/repositories/supplier.repository';
import { tokenizePii, detokenizeArg } from '../pii/tool-pii-helpers';
import { PiiCategory } from '../services/pii-vault.service';

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function asValidDateString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return value;
}

function asNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function formatDatePtBr(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('pt-BR');
}

function sanitizeIdentifier(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/[\s.,;:!?]+$/g, '');
}

function buildProtocolCandidates(identifier: string): string[] {
  const cleaned = identifier.trim();
  if (!cleaned) return [];

  const upper = cleaned.toUpperCase();
  const candidates = new Set<string>([upper]);

  if (upper.startsWith('SC-')) {
    const withoutPrefix = upper.slice(3).trim();
    if (withoutPrefix) candidates.add(withoutPrefix);
  } else {
    candidates.add(`SC-${upper}`);
  }

  return Array.from(candidates);
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

function sanitizeAlphaNumKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

function normalizeCpf(value: unknown): string | null {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length !== 11) return null;
  return digits;
}

function normalizePhone(value: unknown): string | null {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length < 10 || digits.length > 13) return null;
  return digits;
}

function normalizeText(value: unknown): string | null {
  const text = asNonEmptyString(value);
  if (!text) return null;
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isValidPriority(value: unknown): value is SurgeryRequestPriority {
  return [1, 2, 3, 4].includes(Number(value));
}

function priorityLabel(priority: SurgeryRequestPriority): string {
  switch (priority) {
    case SurgeryRequestPriority.LOW:
      return 'Baixa';
    case SurgeryRequestPriority.MEDIUM:
      return 'Média';
    case SurgeryRequestPriority.HIGH:
      return 'Alta';
    case SurgeryRequestPriority.URGENT:
      return 'Urgente';
    default:
      return String(priority);
  }
}

function normalizeProtocolDisplay(protocol: unknown): string {
  const value = String(protocol || '').trim();
  if (!value) return 'SC-N/D';
  return value.toUpperCase().startsWith('SC-')
    ? value.toUpperCase()
    : `SC-${value}`;
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

export function buildWhatsappFlowTools(
  surgeryRequestRepo: SurgeryRequestRepository,
  workflowService: SurgeryRequestWorkflowService,
  surgeryRequestsService: SurgeryRequestsService,
  activityRepo: SurgeryRequestActivityRepository,
  pendencyValidator?: PendencyValidatorService,
  patientRepo?: PatientRepository,
  hospitalRepo?: HospitalRepository,
  healthPlanRepo?: HealthPlanRepository,
  procedureRepo?: ProcedureRepository,
  userRepo?: UserRepository,
  tussItemRepo?: SurgeryRequestTussItemRepository,
  opmeItemRepo?: OpmeItemRepository,
  documentRepo?: DocumentRepository,
  storageService?: StorageService,
  configService?: ConfigService,
  tussService?: TussService,
  supplierRepo?: SupplierRepository,
): AiTool[] {
  const confirmDate: AiTool = {
    name: 'confirm_date',
    definition: {
      type: 'function',
      function: {
        name: 'confirm_date',
        description:
          'Confirma uma das opções de data de cirurgia para a solicitação (índice 0, 1 ou 2). Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
            selectedDateIndex: {
              type: 'number',
              description: 'Índice da data selecionada: 0, 1 ou 2',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a ação. Caso contrário, mostra preview.',
            },
          },
          required: ['surgeryRequestId', 'selectedDateIndex'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;

      const index = args.selectedDateIndex;
      if (!Number.isInteger(index) || ![0, 1, 2].includes(index)) {
        return 'Parâmetro inválido: `selectedDateIndex` deve ser 0, 1 ou 2.';
      }

      if (!args.confirm) {
        return `A solicitação ${auth.request.protocol} será confirmada com a opção de data #${index + 1}. Confirme com "sim" para executar.`;
      }

      try {
        await workflowService.confirmDate(
          auth.request.id,
          { selectedDateIndex: index },
          context.userId as string,
        );

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Data confirmada pela opção #${index + 1}.`,
        });

        return `✅ Data confirmada com sucesso para a solicitação ${auth.request.protocol}.`;
      } catch (err: any) {
        return `Erro ao confirmar data: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const updateDateOptions: AiTool = {
    name: 'update_date_options',
    definition: {
      type: 'function',
      function: {
        name: 'update_date_options',
        description:
          'Atualiza as opções de datas da cirurgia (1 a 3 datas). Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
            dateOptions: {
              type: 'array',
              description: 'Lista de datas (ISO) com 1 a 3 opções',
              items: { type: 'string' },
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a ação. Caso contrário, mostra preview.',
            },
          },
          required: ['surgeryRequestId', 'dateOptions'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;

      if (!Array.isArray(args.dateOptions)) {
        return 'Parâmetro inválido: `dateOptions` deve ser um array de datas.';
      }

      if (args.dateOptions.length < 1 || args.dateOptions.length > 3) {
        return 'Parâmetro inválido: `dateOptions` deve conter entre 1 e 3 datas.';
      }

      const normalizedDates = args.dateOptions.map(asValidDateString);
      if (normalizedDates.some((d) => !d)) {
        return 'Parâmetro inválido: todas as datas em `dateOptions` devem estar em formato válido.';
      }

      if (!args.confirm) {
        const previewDates = (normalizedDates as string[])
          .map((d, i) => `• Opção ${i + 1}: ${formatDatePtBr(d)}`)
          .join('\n');
        return `A solicitação ${auth.request.protocol} terá as opções de data atualizadas para:\n${previewDates}\n\nConfirme com "sim" para executar.`;
      }

      try {
        await workflowService.updateDateOptions(
          auth.request.id,
          { dateOptions: normalizedDates as string[] },
          context.userId as string,
        );

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Opções de data atualizadas (${normalizedDates.length} opções).`,
        });

        return `✅ Opções de data atualizadas com sucesso para a solicitação ${auth.request.protocol}.`;
      } catch (err: any) {
        return `Erro ao atualizar opções de data: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const rescheduleSurgery: AiTool = {
    name: 'reschedule_surgery',
    definition: {
      type: 'function',
      function: {
        name: 'reschedule_surgery',
        description:
          'Reagenda uma cirurgia para uma nova data. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
            new_date: {
              type: 'string',
              description: 'Nova data da cirurgia em formato ISO',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a ação. Caso contrário, mostra preview.',
            },
          },
          required: ['surgeryRequestId', 'new_date'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;

      const newDate = asValidDateString(args.new_date);
      if (!newDate) {
        return 'Parâmetro inválido: `new_date` deve ser uma data válida.';
      }

      if (!args.confirm) {
        return `A solicitação ${auth.request.protocol} será reagendada para ${formatDatePtBr(newDate)}. Confirme com "sim" para executar.`;
      }

      try {
        await workflowService.reschedule(
          auth.request.id,
          { new_date: newDate },
          context.userId as string,
        );

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Cirurgia reagendada para ${newDate}.`,
        });

        return `✅ Solicitação ${auth.request.protocol} reagendada com sucesso.`;
      } catch (err: any) {
        return `Erro ao reagendar cirurgia: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const markPerformed: AiTool = {
    name: 'mark_performed',
    definition: {
      type: 'function',
      function: {
        name: 'mark_performed',
        description:
          'Marca a cirurgia como realizada com data de realização. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
            surgeryPerformedAt: {
              type: 'string',
              description: 'Data da cirurgia realizada em formato ISO',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a ação. Caso contrário, mostra preview.',
            },
          },
          required: ['surgeryRequestId', 'surgeryPerformedAt'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;

      const performedAt = asValidDateString(args.surgeryPerformedAt);
      if (!performedAt) {
        return 'Parâmetro inválido: `surgeryPerformedAt` deve ser uma data válida.';
      }

      if (!args.confirm) {
        return `A solicitação ${auth.request.protocol} será marcada como realizada em ${formatDatePtBr(performedAt)}. Confirme com "sim" para executar.`;
      }

      try {
        await workflowService.markPerformed(
          auth.request.id,
          { surgeryPerformedAt: performedAt },
          context.userId as string,
        );

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Cirurgia marcada como realizada em ${performedAt}.`,
        });

        return `✅ Solicitação ${auth.request.protocol} marcada como realizada.`;
      } catch (err: any) {
        return `Erro ao marcar cirurgia como realizada: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const invoiceRequest: AiTool = {
    name: 'invoice_request',
    definition: {
      type: 'function',
      function: {
        name: 'invoice_request',
        description:
          'Fatura a solicitação com protocolo, valor e data de envio. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
            invoiceProtocol: {
              type: 'string',
              description: 'Protocolo de faturamento',
            },
            invoiceValue: {
              type: 'number',
              description: 'Valor faturado',
            },
            invoiceSentAt: {
              type: 'string',
              description: 'Data de envio da fatura (ISO)',
            },
            paymentDeadline: {
              type: 'string',
              description: 'Prazo de pagamento (ISO) opcional',
            },
            set_as_default_for_health_plan: {
              type: 'boolean',
              description: 'Se true, usa prazo como padrão para o convênio',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a ação. Caso contrário, mostra preview.',
            },
          },
          required: [
            'surgeryRequestId',
            'invoiceProtocol',
            'invoiceValue',
            'invoiceSentAt',
          ],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;

      const protocol = asNonEmptyString(args.invoiceProtocol);
      const value = asNonNegativeNumber(args.invoiceValue);
      const sentAt = asValidDateString(args.invoiceSentAt);

      if (!protocol) {
        return 'Parâmetro inválido: `invoiceProtocol` é obrigatório.';
      }
      if (value === null) {
        return 'Parâmetro inválido: `invoiceValue` deve ser número maior ou igual a 0.';
      }
      if (!sentAt) {
        return 'Parâmetro inválido: `invoiceSentAt` deve ser uma data válida.';
      }

      const paymentDeadline =
        args.paymentDeadline == null
          ? undefined
          : asValidDateString(args.paymentDeadline);

      if (args.paymentDeadline != null && !paymentDeadline) {
        return 'Parâmetro inválido: `paymentDeadline` deve ser uma data válida.';
      }

      if (!args.confirm) {
        const deadlineLine = paymentDeadline
          ? `\n• Prazo: ${formatDatePtBr(paymentDeadline)}`
          : '';
        return `A solicitação ${auth.request.protocol} será faturada com:\n• Protocolo: ${protocol}\n• Valor: R$ ${value.toFixed(2)}\n• Envio: ${formatDatePtBr(sentAt)}${deadlineLine}\n\nConfirme com "sim" para executar.`;
      }

      try {
        await workflowService.invoiceRequest(
          auth.request.id,
          {
            invoiceProtocol: protocol,
            invoiceValue: value,
            invoiceSentAt: sentAt,
            paymentDeadline: paymentDeadline,
            set_as_default_for_health_plan:
              args.set_as_default_for_health_plan === true,
          },
          context.userId as string,
        );

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Faturamento registrado. Protocolo: ${protocol}, valor: ${value.toFixed(2)}.`,
        });

        return `✅ Faturamento registrado com sucesso para a solicitação ${auth.request.protocol}.`;
      } catch (err: any) {
        return `Erro ao faturar solicitação: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const confirmReceipt: AiTool = {
    name: 'confirm_receipt',
    definition: {
      type: 'function',
      function: {
        name: 'confirm_receipt',
        description:
          'Confirma o recebimento financeiro de uma solicitação faturada. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
            receivedValue: {
              type: 'number',
              description: 'Valor recebido',
            },
            receivedAt: {
              type: 'string',
              description: 'Data do recebimento (ISO)',
            },
            receiptNotes: {
              type: 'string',
              description: 'Observações do recebimento (opcional)',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a ação. Caso contrário, mostra preview.',
            },
          },
          required: ['surgeryRequestId', 'receivedValue', 'receivedAt'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;

      const value = asNonNegativeNumber(args.receivedValue);
      const receivedAt = asValidDateString(args.receivedAt);

      if (value === null) {
        return 'Parâmetro inválido: `receivedValue` deve ser número maior ou igual a 0.';
      }
      if (!receivedAt) {
        return 'Parâmetro inválido: `receivedAt` deve ser uma data válida.';
      }

      if (args.receiptNotes != null && typeof args.receiptNotes !== 'string') {
        return 'Parâmetro inválido: `receiptNotes` deve ser texto.';
      }

      if (!args.confirm) {
        return `A solicitação ${auth.request.protocol} terá o recebimento confirmado:\n• Valor: R$ ${value.toFixed(2)}\n• Data: ${formatDatePtBr(receivedAt)}\n\nConfirme com "sim" para executar.`;
      }

      try {
        await workflowService.confirmReceipt(
          auth.request.id,
          {
            receivedValue: value,
            receivedAt: receivedAt,
            receiptNotes: args.receiptNotes,
          },
          context.userId as string,
        );

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Recebimento confirmado. Valor: ${value.toFixed(2)}, data: ${receivedAt}.`,
        });

        return `✅ Recebimento confirmado com sucesso para a solicitação ${auth.request.protocol}.`;
      } catch (err: any) {
        return `Erro ao confirmar recebimento: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const contestAuthorizationFull: AiTool = {
    name: 'contest_authorization_full',
    definition: {
      type: 'function',
      function: {
        name: 'contest_authorization_full',
        description:
          'Registra contestação de autorização com método de envio (email/download/document). Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
            reason: {
              type: 'string',
              description: 'Motivo da contestação',
            },
            method: {
              type: 'string',
              description: 'Método de envio: email, download ou document',
            },
            to: {
              type: 'string',
              description: 'Destinatário (obrigatório para email)',
            },
            subject: {
              type: 'string',
              description: 'Assunto (obrigatório para email)',
            },
            message: {
              type: 'string',
              description: 'Mensagem (obrigatória para email)',
            },
            attachments: {
              type: 'array',
              description: 'IDs de anexos (opcional)',
              items: { type: 'string' },
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a ação. Caso contrário, mostra preview.',
            },
          },
          required: ['surgeryRequestId', 'reason', 'method'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;

      const reason = asNonEmptyString(args.reason);
      const method = asNonEmptyString(args.method);
      if (!reason) {
        return 'Parâmetro inválido: `reason` é obrigatório.';
      }

      if (
        !method ||
        !Object.values(SendMethod).includes(method as SendMethod)
      ) {
        return 'Parâmetro inválido: `method` deve ser email, download ou document.';
      }

      if (method === SendMethod.EMAIL) {
        if (
          !asNonEmptyString(args.to) ||
          !asNonEmptyString(args.subject) ||
          !asNonEmptyString(args.message)
        ) {
          return 'Parâmetro inválido: para `method=email`, informe `to`, `subject` e `message`.';
        }
      }

      if (args.attachments != null && !Array.isArray(args.attachments)) {
        return 'Parâmetro inválido: `attachments` deve ser array de strings.';
      }

      if (
        Array.isArray(args.attachments) &&
        args.attachments.some((item: unknown) => typeof item !== 'string')
      ) {
        return 'Parâmetro inválido: `attachments` deve conter apenas strings.';
      }

      if (!args.confirm) {
        return `A solicitação ${auth.request.protocol} terá contestação de autorização registrada.\n• Método: ${method}\n• Motivo: ${reason}\n\nConfirme com "sim" para executar.`;
      }

      try {
        await workflowService.contestAuthorization(
          auth.request.id,
          {
            reason,
            method: method as SendMethod,
            to: args.to,
            subject: args.subject,
            message: args.message,
            attachments: args.attachments,
          },
          context.userId as string,
        );

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Contestação de autorização registrada por ${method}.`,
        });

        return `✅ Contestação de autorização registrada com sucesso para a solicitação ${auth.request.protocol}.`;
      } catch (err: any) {
        return `Erro ao contestar autorização: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const contestPayment: AiTool = {
    name: 'contest_payment',
    definition: {
      type: 'function',
      function: {
        name: 'contest_payment',
        description:
          'Registra contestação de pagamento com destinatário, assunto e mensagem. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
            to: {
              type: 'string',
              description: 'Destinatário da contestação',
            },
            subject: {
              type: 'string',
              description: 'Assunto da contestação',
            },
            message: {
              type: 'string',
              description: 'Mensagem da contestação',
            },
            attachments: {
              type: 'array',
              description: 'IDs de anexos (opcional)',
              items: { type: 'string' },
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a ação. Caso contrário, mostra preview.',
            },
          },
          required: ['surgeryRequestId', 'to', 'subject', 'message'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;

      const to = asNonEmptyString(args.to);
      const subject = asNonEmptyString(args.subject);
      const message = asNonEmptyString(args.message);

      if (!to || !subject || !message) {
        return 'Parâmetro inválido: informe `to`, `subject` e `message`.';
      }

      if (args.attachments != null && !Array.isArray(args.attachments)) {
        return 'Parâmetro inválido: `attachments` deve ser array de strings.';
      }

      if (
        Array.isArray(args.attachments) &&
        args.attachments.some((item: unknown) => typeof item !== 'string')
      ) {
        return 'Parâmetro inválido: `attachments` deve conter apenas strings.';
      }

      if (!args.confirm) {
        return `A solicitação ${auth.request.protocol} terá contestação de pagamento registrada para ${to}. Confirme com "sim" para executar.`;
      }

      try {
        await workflowService.contestPayment(
          auth.request.id,
          {
            to,
            subject,
            message,
            attachments: args.attachments,
          },
          context.userId as string,
        );

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Contestação de pagamento registrada para ${to}.`,
        });

        return `✅ Contestação de pagamento registrada com sucesso para a solicitação ${auth.request.protocol}.`;
      } catch (err: any) {
        return `Erro ao contestar pagamento: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const updateReceipt: AiTool = {
    name: 'update_receipt',
    definition: {
      type: 'function',
      function: {
        name: 'update_receipt',
        description:
          'Atualiza dados de recebimento (valor e data) após faturamento/finalização. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
            receivedValue: {
              type: 'number',
              description: 'Novo valor recebido',
            },
            receivedAt: {
              type: 'string',
              description: 'Nova data de recebimento (ISO)',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a ação. Caso contrário, mostra preview.',
            },
          },
          required: ['surgeryRequestId', 'receivedValue', 'receivedAt'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;

      const value = asNonNegativeNumber(args.receivedValue);
      const receivedAt = asValidDateString(args.receivedAt);

      if (value === null) {
        return 'Parâmetro inválido: `receivedValue` deve ser número maior ou igual a 0.';
      }
      if (!receivedAt) {
        return 'Parâmetro inválido: `receivedAt` deve ser uma data válida.';
      }

      if (!args.confirm) {
        return `A solicitação ${auth.request.protocol} terá recebimento atualizado para:\n• Valor: R$ ${value.toFixed(2)}\n• Data: ${formatDatePtBr(receivedAt)}\n\nConfirme com "sim" para executar.`;
      }

      try {
        await workflowService.updateReceipt(
          auth.request.id,
          {
            receivedValue: value,
            receivedAt: receivedAt,
          },
          context.userId as string,
        );

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Recebimento atualizado. Valor: ${value.toFixed(2)}, data: ${receivedAt}.`,
        });

        return `✅ Recebimento atualizado com sucesso para a solicitação ${auth.request.protocol}.`;
      } catch (err: any) {
        return `Erro ao atualizar recebimento: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const manageReportSections: AiTool = {
    name: 'manage_report_sections',
    definition: {
      type: 'function',
      function: {
        name: 'manage_report_sections',
        description:
          'Gerencia seções do laudo: listar, criar, editar, excluir e reordenar.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
            operation: {
              type: 'string',
              description: 'Operação: list, create, edit, delete ou reorder',
            },
            section_id: {
              type: 'string',
              description: 'ID da seção (obrigatório em edit/delete)',
            },
            title: {
              type: 'string',
              description: 'Título da seção (create/edit)',
            },
            description: {
              type: 'string',
              description: 'Descrição da seção (create/edit)',
            },
            ids: {
              type: 'array',
              description: 'Lista ordenada de IDs para reorder',
              items: { type: 'string' },
            },
            confirm: {
              type: 'boolean',
              description: 'Obrigatório para operações de mutação.',
            },
          },
          required: ['surgeryRequestId', 'operation'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;

      const operation = asNonEmptyString(args.operation)?.toLowerCase();
      if (
        !operation ||
        !['list', 'create', 'edit', 'delete', 'reorder'].includes(operation)
      ) {
        return 'Parâmetro inválido: `operation` deve ser list, create, edit, delete ou reorder.';
      }

      if (operation === 'list') {
        const sections = await surgeryRequestsService.getReportSections(
          auth.request.id,
          context.userId as string,
        );

        if (!sections.length) {
          return `Nenhuma seção de laudo cadastrada para a solicitação ${auth.request.protocol}.`;
        }

        const lines = sections.map(
          (section, index) =>
            `${index + 1}. ${section.title} (id: ${section.id})${section.description ? `\n   ${section.description}` : ''}`,
        );

        return `🧾 Seções do laudo da solicitação ${auth.request.protocol}:\n${lines.join('\n')}`;
      }

      if (!args.confirm) {
        switch (operation) {
          case 'create': {
            const title = asNonEmptyString(args.title);
            if (!title) {
              return 'Parâmetro inválido: `title` é obrigatório para create.';
            }
            return `Será criada uma nova seção de laudo na solicitação ${auth.request.protocol} com título "${title}". Confirme com "sim" para executar.`;
          }
          case 'edit': {
            const sectionId = asNonEmptyString(args.section_id);
            if (!sectionId) {
              return 'Parâmetro inválido: `section_id` é obrigatório para edit.';
            }
            if (args.title == null && args.description == null) {
              return 'Parâmetro inválido: informe `title` e/ou `description` para edit.';
            }
            return `A seção ${sectionId} da solicitação ${auth.request.protocol} será atualizada. Confirme com "sim" para executar.`;
          }
          case 'delete': {
            const sectionId = asNonEmptyString(args.section_id);
            if (!sectionId) {
              return 'Parâmetro inválido: `section_id` é obrigatório para delete.';
            }
            return `A seção ${sectionId} da solicitação ${auth.request.protocol} será excluída. Confirme com "sim" para executar.`;
          }
          case 'reorder': {
            if (!Array.isArray(args.ids) || !args.ids.length) {
              return 'Parâmetro inválido: `ids` deve ser um array não vazio para reorder.';
            }
            if (args.ids.some((id: unknown) => typeof id !== 'string')) {
              return 'Parâmetro inválido: `ids` deve conter apenas strings.';
            }
            return `A ordem das seções de laudo da solicitação ${auth.request.protocol} será atualizada com ${args.ids.length} itens. Confirme com "sim" para executar.`;
          }
        }
      }

      try {
        switch (operation) {
          case 'create': {
            const title = asNonEmptyString(detokenizeArg(context, args.title));
            if (!title) {
              return 'Parâmetro inválido: `title` é obrigatório para create.';
            }

            const detokenizedDescription =
              args.description == null
                ? undefined
                : (detokenizeArg(context, args.description) ?? undefined);

            const section = await surgeryRequestsService.createReportSection(
              auth.request.id,
              {
                title,
                description: detokenizedDescription,
              },
              context.userId as string,
            );

            await activityRepo.create({
              surgeryRequestId: auth.request.id,
              userId: context.userId as string,
              type: ActivityType.SYSTEM,
              content: `[WhatsApp IA] Seção de laudo criada (${section.id}).`,
            });

            return `✅ Seção criada com sucesso: ${section.title} (id: ${section.id}).`;
          }
          case 'edit': {
            const sectionId = asNonEmptyString(args.section_id);
            if (!sectionId) {
              return 'Parâmetro inválido: `section_id` é obrigatório para edit.';
            }

            if (args.title == null && args.description == null) {
              return 'Parâmetro inválido: informe `title` e/ou `description` para edit.';
            }

            const updated = await surgeryRequestsService.updateReportSection(
              auth.request.id,
              sectionId,
              {
                title:
                  args.title == null
                    ? undefined
                    : (detokenizeArg(context, args.title) ?? undefined),
                description:
                  args.description == null
                    ? undefined
                    : (detokenizeArg(context, args.description) ?? undefined),
              },
              context.userId as string,
            );

            await activityRepo.create({
              surgeryRequestId: auth.request.id,
              userId: context.userId as string,
              type: ActivityType.SYSTEM,
              content: `[WhatsApp IA] Seção de laudo atualizada (${updated.id}).`,
            });

            return `✅ Seção atualizada com sucesso: ${updated.title} (id: ${updated.id}).`;
          }
          case 'delete': {
            const sectionId = asNonEmptyString(args.section_id);
            if (!sectionId) {
              return 'Parâmetro inválido: `section_id` é obrigatório para delete.';
            }

            const result = await surgeryRequestsService.deleteReportSection(
              auth.request.id,
              sectionId,
              context.userId as string,
            );

            await activityRepo.create({
              surgeryRequestId: auth.request.id,
              userId: context.userId as string,
              type: ActivityType.SYSTEM,
              content: `[WhatsApp IA] Seção de laudo removida (${sectionId}).`,
            });

            return result.deleted
              ? `✅ Seção ${sectionId} removida com sucesso.`
              : `Nenhuma seção removida para id ${sectionId}.`;
          }
          case 'reorder': {
            if (!Array.isArray(args.ids) || !args.ids.length) {
              return 'Parâmetro inválido: `ids` deve ser um array não vazio para reorder.';
            }

            if (args.ids.some((id: unknown) => typeof id !== 'string')) {
              return 'Parâmetro inválido: `ids` deve conter apenas strings.';
            }

            const sections = await surgeryRequestsService.reorderReportSections(
              auth.request.id,
              { ids: args.ids },
              context.userId as string,
            );

            await activityRepo.create({
              surgeryRequestId: auth.request.id,
              userId: context.userId as string,
              type: ActivityType.SYSTEM,
              content: `[WhatsApp IA] Seções de laudo reordenadas (${args.ids.length} itens).`,
            });

            return `✅ Seções reordenadas com sucesso. Total de seções: ${sections.length}.`;
          }
        }

        return 'Operação não suportada.';
      } catch (err: any) {
        return `Erro ao gerenciar seções do laudo: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const setHospital: AiTool = {
    name: 'set_hospital',
    definition: {
      type: 'function',
      function: {
        name: 'set_hospital',
        description:
          'Define ou troca o hospital da solicitação. Aceita `hospitalId` ou `hospital_name`. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: { type: 'string' },
            hospitalId: { type: 'string' },
            hospital_name: { type: 'string' },
            hospital_email: { type: 'string' },
            confirm: { type: 'boolean' },
          },
          required: ['surgeryRequestId'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;
      if (!hospitalRepo) return 'Ferramenta indisponível no momento.';

      const hospitalId = asNonEmptyString(args.hospitalId);
      const hospitalName = asNonEmptyString(
        detokenizeArg(context, args.hospital_name),
      );

      if (!hospitalId && !hospitalName) {
        return 'Parâmetro inválido: informe `hospitalId` ou `hospital_name`.';
      }

      const protocolToken = tokenizePii(
        context,
        'set_hospital',
        'protocol',
        auth.request.protocol,
      );

      if (!args.confirm) {
        const previewName = hospitalName
          ? tokenizePii(context, 'set_hospital', 'hospital_name', hospitalName)
          : hospitalId;
        return `A solicitação ${protocolToken} terá o hospital atualizado para ${previewName}. Confirme com "sim" para executar.`;
      }

      let selectedHospital = null as any;

      if (hospitalId) {
        selectedHospital = await hospitalRepo.findOne({ id: hospitalId });
      } else {
        selectedHospital = await hospitalRepo.findOne({
          name: hospitalName as string,
          doctorId: auth.request.doctorId,
        } as any);

        if (!selectedHospital) {
          selectedHospital = await hospitalRepo.create({
            name: hospitalName,
            email:
              asNonEmptyString(detokenizeArg(context, args.hospital_email)) ||
              undefined,
            doctorId: auth.request.doctorId,
            active: true,
          } as any);
        }
      }

      if (!selectedHospital) {
        return 'Hospital não encontrado para atualização.';
      }

      await surgeryRequestRepo.update(auth.request.id, {
        hospitalId: selectedHospital.id,
      } as any);

      await activityRepo.create({
        surgeryRequestId: auth.request.id,
        userId: context.userId as string,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Hospital definido para ${selectedHospital.name}.`,
      });

      const successName = tokenizePii(
        context,
        'set_hospital',
        'hospital_name',
        selectedHospital.name,
      );
      return `Hospital atualizado com sucesso para ${successName} na solicitação ${protocolToken}.`;
    },
  };

  const addTussItem: AiTool = {
    name: 'add_tuss_item',
    definition: {
      type: 'function',
      function: {
        name: 'add_tuss_item',
        description:
          'Adiciona item TUSS na solicitação. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: { type: 'string' },
            tussCode: { type: 'string' },
            name: { type: 'string' },
            quantity: { type: 'number' },
            confirm: { type: 'boolean' },
          },
          required: ['surgeryRequestId', 'tussCode', 'name'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;
      if (!tussItemRepo) return 'Ferramenta indisponível no momento.';

      const tussCode = asNonEmptyString(args.tussCode);
      const name = asNonEmptyString(args.name);
      const quantity =
        typeof args.quantity === 'number' &&
        Number.isFinite(args.quantity) &&
        args.quantity > 0
          ? Math.floor(args.quantity)
          : 1;

      if (!tussCode || !name) {
        return 'Parâmetro inválido: informe `tussCode` e `name`.';
      }

      if (!args.confirm) {
        return `A solicitação ${auth.request.protocol} receberá o item TUSS ${tussCode} (${name}), quantidade ${quantity}. Confirme com "sim" para executar.`;
      }

      await tussItemRepo.create({
        surgeryRequestId: auth.request.id,
        tussCode: tussCode,
        name,
        quantity,
      } as any);

      await activityRepo.create({
        surgeryRequestId: auth.request.id,
        userId: context.userId as string,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Item TUSS adicionado: ${tussCode} - ${name} (qtd: ${quantity}).`,
      });

      return `Item TUSS adicionado com sucesso na solicitação ${auth.request.protocol}.`;
    },
  };

  const addOpmeItem: AiTool = {
    name: 'add_opme_item',
    definition: {
      type: 'function',
      function: {
        name: 'add_opme_item',
        description:
          'Adiciona item OPME na solicitação. Exige ao menos 3 fabricantes e 3 fornecedores. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: { type: 'string' },
            name: { type: 'string' },
            quantity: { type: 'number' },
            manufacturer_names: {
              type: 'array',
              items: { type: 'string' },
              description: 'Lista com ao menos 3 fabricantes',
            },
            supplier_names: {
              type: 'array',
              items: { type: 'string' },
              description: 'Lista com ao menos 3 fornecedores',
            },
            brand: {
              type: 'string',
              description:
                'Compatibilidade legada (será tratado como lista de fabricantes se informado).',
            },
            confirm: { type: 'boolean' },
          },
          required: [
            'surgeryRequestId',
            'name',
            'manufacturer_names',
            'supplier_names',
          ],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;
      if (!opmeItemRepo) return 'Ferramenta indisponível no momento.';
      if (!supplierRepo) return 'Ferramenta indisponível no momento.';

      const name = asNonEmptyString(args.name);
      const manufacturerNames = parseStringList(
        args.manufacturer_names ?? args.manufacturers ?? args.brand,
      );
      const supplierNames = parseStringList(args.supplier_names);

      const quantity =
        typeof args.quantity === 'number' &&
        Number.isFinite(args.quantity) &&
        args.quantity > 0
          ? Math.floor(args.quantity)
          : 1;

      if (!name) return 'Parâmetro inválido: `name` é obrigatório.';
      if (manufacturerNames.length < 3) {
        return 'Para adicionar OPME, informe ao menos 3 fabricantes em `manufacturer_names`. Ex.: ["Fabricante 1", "Fabricante 2", "Fabricante 3"].';
      }
      if (supplierNames.length < 3) {
        return 'Para adicionar OPME, informe ao menos 3 fornecedores em `supplier_names`. Ex.: ["Fornecedor 1", "Fornecedor 2", "Fornecedor 3"].';
      }

      if (!args.confirm) {
        return `A solicitação ${auth.request.protocol} receberá item OPME ${name}, quantidade ${quantity}, com ${manufacturerNames.length} fabricantes e ${supplierNames.length} fornecedores. Confirme com "sim" para executar.`;
      }

      const suppliers = [] as any[];
      for (const supplierName of supplierNames) {
        const found = await supplierRepo.findMany(
          {
            doctorId: auth.request.doctorId,
            name: supplierName,
          } as any,
          0,
          1,
        );

        if (found.length > 0) {
          suppliers.push(found[0]);
          continue;
        }

        const createdSupplier = await supplierRepo.create({
          doctorId: auth.request.doctorId,
          name: supplierName,
          active: true,
        } as any);
        suppliers.push(createdSupplier);
      }

      await surgeryRequestsService.setHasOpme(
        auth.request.id,
        true,
        context.userId as string,
      );
      await opmeItemRepo.create({
        surgeryRequestId: auth.request.id,
        name,
        brand: manufacturerNames.join(', '),
        quantity,
        suppliers,
      } as any);

      await activityRepo.create({
        surgeryRequestId: auth.request.id,
        userId: context.userId as string,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Item OPME adicionado: ${name}, qtd ${quantity}, fabricantes (${manufacturerNames.length}) e fornecedores (${supplierNames.length}).`,
      });

      return `Item OPME adicionado com sucesso na solicitação ${auth.request.protocol}.`;
    },
  };

  const updateRequestClinicalData: AiTool = {
    name: 'update_request_clinical_data',
    definition: {
      type: 'function',
      function: {
        name: 'update_request_clinical_data',
        description:
          'Atualiza dados clínicos da solicitação (diagnóstico, laudo, histórico, descrição cirúrgica, CID/TUSS). Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: { type: 'string' },
            diagnosis: { type: 'string' },
            medicalReport: { type: 'string' },
            patientHistory: { type: 'string' },
            surgeryDescription: { type: 'string' },
            cidCode: { type: 'string' },

            confirm: { type: 'boolean' },
          },
          required: ['surgeryRequestId'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;

      const payload: Record<string, any> = {};
      const changes: string[] = [];

      const SENSITIVE_CLINICAL_FIELDS = new Set([
        'diagnosis',
        'medicalReport',
        'patientHistory',
        'surgeryDescription',
      ]);

      for (const key of [
        'diagnosis',
        'medicalReport',
        'patientHistory',
        'surgeryDescription',
        'cidCode',
      ]) {
        if (args[key] !== undefined) {
          payload[key] = SENSITIVE_CLINICAL_FIELDS.has(key)
            ? detokenizeArg(context, args[key])
            : args[key];
          changes.push(key);
        }
      }

      if (!changes.length) {
        return 'Nenhuma alteração clínica informada.';
      }

      if (!args.confirm) {
        const protocolToken = tokenizePii(
          context,
          'update_request_clinical_data',
          'protocol',
          auth.request.protocol,
        );
        return `A solicitação ${protocolToken} terá atualização clínica nos campos: ${changes.join(', ')}. Confirme com "sim" para executar.`;
      }

      await surgeryRequestRepo.update(auth.request.id, payload as any);

      await activityRepo.create({
        surgeryRequestId: auth.request.id,
        userId: context.userId as string,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Dados clínicos atualizados: ${changes.join(', ')}.`,
      });

      const protocolTokenSuccess = tokenizePii(
        context,
        'update_request_clinical_data',
        'protocol',
        auth.request.protocol,
      );
      return `Dados clínicos atualizados com sucesso na solicitação ${protocolTokenSuccess}.`;
    },
  };

  const updateRequestAdminData: AiTool = {
    name: 'update_request_admin_data',
    definition: {
      type: 'function',
      function: {
        name: 'update_request_admin_data',
        description:
          'Atualiza dados administrativos da solicitação (convênio, protocolo, prioridade e dados do paciente). Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: { type: 'string' },
            healthPlanRegistration: { type: 'string' },
            healthPlanType: { type: 'string' },
            healthPlanProtocol: { type: 'string' },
            priority: { type: 'number' },
            patient_cpf: { type: 'string' },
            patient_phone: { type: 'string' },
            patient_birth_date: { type: 'string' },
            confirm: { type: 'boolean' },
          },
          required: ['surgeryRequestId'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;

      const requestPayload: Record<string, any> = {};
      const requestChanges: string[] = [];

      for (const key of [
        'healthPlanRegistration',
        'healthPlanType',
        'healthPlanProtocol',
        'priority',
      ]) {
        if (args[key] !== undefined) {
          requestPayload[key] = args[key];
          requestChanges.push(key);
        }
      }

      const patientPayload: Record<string, any> = {};
      const patientChanges: string[] = [];

      const cpfDetokenized = detokenizeArg(context, args.patient_cpf);
      const cpf = normalizeCpf(cpfDetokenized);
      if (args.patient_cpf !== undefined) {
        if (!cpf)
          return 'Parâmetro inválido: `patient_cpf` deve conter 11 dígitos.';
        patientPayload.cpf = cpf;
        patientChanges.push('cpf');
      }

      const phoneDetokenized = detokenizeArg(context, args.patient_phone);
      const phone = normalizePhone(phoneDetokenized);
      if (args.patient_phone !== undefined) {
        if (!phone)
          return 'Parâmetro inválido: `patient_phone` está em formato inválido.';
        patientPayload.phone = phone;
        patientChanges.push('phone');
      }

      if (args.patient_birth_date !== undefined) {
        const birthRaw = detokenizeArg(context, args.patient_birth_date);
        const birthDate = asValidDateString(birthRaw);
        if (!birthDate) {
          return 'Parâmetro inválido: `patient_birth_date` deve ser uma data válida (YYYY-MM-DD).';
        }
        patientPayload.birthDate = birthDate;
        patientChanges.push('birthDate');
      }

      if (!requestChanges.length && !patientChanges.length) {
        return 'Nenhuma alteração administrativa informada.';
      }

      const protocolToken = tokenizePii(
        context,
        'update_request_admin_data',
        'protocol',
        auth.request.protocol,
      );

      if (!args.confirm) {
        return `A solicitação ${protocolToken} terá atualização administrativa. Campos da solicitação: ${requestChanges.join(', ') || 'nenhum'}. Campos do paciente: ${patientChanges.join(', ') || 'nenhum'}. Confirme com "sim" para executar.`;
      }

      if (requestChanges.length) {
        await surgeryRequestRepo.update(auth.request.id, requestPayload as any);
      }

      if (patientChanges.length && patientRepo && auth.request.patientId) {
        await patientRepo.update(auth.request.patientId, patientPayload as any);
      }

      await activityRepo.create({
        surgeryRequestId: auth.request.id,
        userId: context.userId as string,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Dados administrativos atualizados. Solicitação: ${requestChanges.join(', ') || 'nenhum'}. Paciente: ${patientChanges.join(', ') || 'nenhum'}.`,
      });

      return `Dados administrativos atualizados com sucesso na solicitação ${protocolToken}.`;
    },
  };

  const attachDocumentFromWhatsapp: AiTool = {
    name: 'attach_document_from_whatsapp',
    definition: {
      type: 'function',
      function: {
        name: 'attach_document_from_whatsapp',
        description:
          'Anexa a mídia recebida no WhatsApp como documento da solicitação. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgeryRequestId: { type: 'string' },
            document_type: { type: 'string' },
            document_name: { type: 'string' },
            document_key: { type: 'string' },
            media_index: { type: 'number' },
            confirm: { type: 'boolean' },
          },
          required: ['surgeryRequestId'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      if (!args.surgeryRequestId) {
        return 'Para anexar documento, informe `surgeryRequestId` ou protocolo da solicitação.';
      }

      const auth = await getAuthorizedRequest(
        surgeryRequestRepo,
        args.surgeryRequestId,
        context,
      );
      if (!auth.ok) return auth.message;
      if (!documentRepo || !storageService) {
        return 'Pipeline de anexos indisponível no momento.';
      }

      const inboundMedia = context.inboundMedia || [];
      if (!inboundMedia.length) {
        return 'Não identifiquei mídia nesta mensagem. Envie o arquivo no WhatsApp e solicite novamente o anexo.';
      }

      const mediaIndex =
        typeof args.media_index === 'number' &&
        Number.isInteger(args.media_index) &&
        args.media_index >= 0 &&
        args.media_index < inboundMedia.length
          ? args.media_index
          : 0;

      const media = inboundMedia[mediaIndex];
      const detectedType = classifyDocumentType(
        media.contentType,
        args.document_type,
      );
      const providedName = asNonEmptyString(args.document_name);
      const computedKey =
        asNonEmptyString(args.document_key) ||
        sanitizeAlphaNumKey(
          detectedType || providedName || 'documento_whatsapp',
        );
      const computedName =
        providedName ||
        `Documento WhatsApp ${new Date().toLocaleDateString('pt-BR')}`;

      if (!args.confirm) {
        return `Documento identificado para a solicitação ${auth.request.protocol}. Tipo: ${detectedType}. Nome: ${computedName}. Chave: ${computedKey}. Confirme com "sim" para anexar.`;
      }

      try {
        const downloaded = await downloadInboundMedia(media.url, configService);
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

        await documentRepo.create({
          surgeryRequestId: auth.request.id,
          createdBy: context.userId as string,
          type: detectedType,
          key: computedKey,
          name: computedName,
          uri: path,
        } as any);

        await activityRepo.create({
          surgeryRequestId: auth.request.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Documento anexado via mídia inbound. Tipo: ${detectedType}, chave: ${computedKey}.`,
        });

        return `Documento anexado com sucesso na solicitação ${auth.request.protocol}. Tipo: ${detectedType}.`;
      } catch (err: any) {
        return `Erro ao anexar documento: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const listScCreationCatalog: AiTool = {
    name: 'list_sc_creation_catalog',
    definition: {
      type: 'function',
      function: {
        name: 'list_sc_creation_catalog',
        description:
          'Lista categorias e registros disponíveis para criação de solicitação via WhatsApp (pacientes, procedimentos, convênios, hospitais, médicos e modelos).',
        parameters: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description:
                'Categoria opcional: patients, procedures, health_plans, hospitals, doctors, templates. Se omitido, retorna resumo de todas.',
            },
            limit: {
              type: 'number',
              description: 'Quantidade máxima por categoria (padrão: 20).',
            },
          },
          required: [],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const normalizedCategory = asNonEmptyString(args.category)
        ?.toLowerCase()
        .trim();
      const limit =
        typeof args.limit === 'number' && Number.isFinite(args.limit)
          ? Math.min(Math.max(Math.floor(args.limit), 1), 100)
          : 20;

      const doctorWhere = context.accessibleDoctorIds.length
        ? ({ doctorId: In(context.accessibleDoctorIds) } as any)
        : ({ doctorId: '__none__' } as any);

      const [
        patients,
        hospitals,
        healthPlans,
        procedures,
        tussCatalog,
        doctors,
        templates,
      ] = await Promise.all([
        patientRepo
          ? patientRepo.findMany(doctorWhere, 0, limit)
          : Promise.resolve([] as any[]),
        hospitalRepo
          ? hospitalRepo.findMany(doctorWhere, 0, limit)
          : Promise.resolve([] as any[]),
        healthPlanRepo
          ? healthPlanRepo.findMany(doctorWhere, 0, limit)
          : Promise.resolve([] as any[]),
        procedureRepo
          ? procedureRepo.findMany({} as any, 0, limit)
          : Promise.resolve([] as any[]),
        tussService
          ? tussService.search(undefined, limit)
          : Promise.resolve([] as any[]),
        userRepo && context.accessibleDoctorIds.length
          ? userRepo.findMany(
              { id: In(context.accessibleDoctorIds) } as any,
              0,
              limit,
            )
          : Promise.resolve([] as any[]),
        surgeryRequestsService.getTemplates(context.userId as string),
      ]);

      const categoryMap: Record<string, { label: string; items: any[] }> = {
        patients: { label: 'Pacientes', items: patients as any[] },
        procedures: {
          label: 'Procedimentos TUSS',
          items: ((tussCatalog as any[])?.length
            ? (tussCatalog as any[])
            : (procedures as any[])) as any[],
        },
        health_plans: { label: 'Convênios', items: healthPlans as any[] },
        hospitals: { label: 'Hospitais', items: hospitals as any[] },
        doctors: { label: 'Médicos', items: doctors as any[] },
        templates: { label: 'Modelos', items: (templates as any[]) || [] },
      };

      const CATEGORY_TO_PII: Record<string, PiiCategory | null> = {
        patients: 'patient_name',
        hospitals: 'hospital_name',
        health_plans: 'health_plan_name',
        doctors: 'doctor_name',
        procedures: null,
        templates: null,
      };

      const formatItems = (
        categoryKey: string,
        label: string,
        items: any[],
      ): string => {
        if (!items.length) return `• ${label}: nenhum cadastrado`;
        const piiCategory = CATEGORY_TO_PII[categoryKey] ?? null;
        const lines = items.slice(0, limit).map((item) => {
          const rawName = item.name || item.title || 'Sem nome';
          if (categoryKey === 'procedures') {
            const tussCode = asNonEmptyString(item.tussCode);
            return tussCode
              ? `  - ${rawName} (Código TUSS: ${tussCode})`
              : `  - ${rawName}`;
          }

          const displayName = piiCategory
            ? tokenizePii(
                context,
                'list_sc_creation_catalog',
                piiCategory,
                rawName,
              )
            : rawName;
          return `  - ${displayName} (id: ${item.id})`;
        });
        return [`• ${label} (${items.length}):`, ...lines].join('\n');
      };

      if (normalizedCategory) {
        const category = categoryMap[normalizedCategory];
        if (!category) {
          return 'Categoria inválida. Use: patients, procedures, health_plans, hospitals, doctors, templates.';
        }

        return [
          `📚 ${category.label} disponíveis para criação da SC:`,
          formatItems(normalizedCategory, category.label, category.items),
        ].join('\n');
      }

      return [
        '📚 Categorias disponíveis para montar sua solicitação:',
        formatItems('patients', 'Pacientes', categoryMap.patients.items),
        formatItems(
          'procedures',
          'Procedimentos TUSS',
          categoryMap.procedures.items,
        ),
        formatItems(
          'health_plans',
          'Convênios',
          categoryMap.health_plans.items,
        ),
        formatItems('hospitals', 'Hospitais', categoryMap.hospitals.items),
        formatItems('doctors', 'Médicos', categoryMap.doctors.items),
        formatItems('templates', 'Modelos', categoryMap.templates.items),
        'Se quiser, posso listar uma categoria específica em mais detalhes.',
      ].join('\n');
    },
  };

  const createScCatalogRecord: AiTool = {
    name: 'create_sc_catalog_record',
    definition: {
      type: 'function',
      function: {
        name: 'create_sc_catalog_record',
        description:
          'Cria um registro auxiliar para uso na criação da SC (paciente, hospital, convênio, procedimento ou modelo). Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description:
                'Categoria: patient, hospital, healthPlan, procedure ou template.',
            },
            doctorId: {
              type: 'string',
              description:
                'ID do médico (opcional quando houver apenas um acessível).',
            },
            name: { type: 'string', description: 'Nome do registro.' },
            phone: {
              type: 'string',
              description: 'Telefone (quando aplicável).',
            },
            email: { type: 'string', description: 'Email (quando aplicável).' },
            templateData: {
              type: 'object',
              description: 'Dados do template (apenas para category=template).',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a criação. Caso contrário, mostra preview.',
            },
          },
          required: ['category', 'name'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const category = asNonEmptyString(args.category)?.toLowerCase();
      const name = asNonEmptyString(args.name);
      if (!category || !name) {
        return 'Parâmetro inválido: informe `category` e `name`.';
      }

      const hasSingleDoctor = context.accessibleDoctorIds.length === 1;
      const doctorId =
        asNonEmptyString(args.doctorId) ||
        (hasSingleDoctor ? context.accessibleDoctorIds[0] : null);

      if (
        ['patient', 'hospital', 'healthPlan'].includes(category) &&
        !doctorId
      ) {
        return 'Para essa categoria, informe `doctorId` (há mais de um médico acessível).';
      }

      if (doctorId && !context.accessibleDoctorIds.includes(doctorId)) {
        return 'Você não tem permissão para criar registro para esse médico.';
      }

      if (!args.confirm) {
        return `Pré-visualização: vou criar um registro de categoria ${category} com nome "${name}". Confirme com "sim" para executar.`;
      }

      try {
        if (category === 'patient') {
          if (!patientRepo || !doctorId)
            return 'Fluxo de paciente indisponível.';
          const phone = asNonEmptyString(args.phone);
          const email = asNonEmptyString(args.email);
          if (!phone || !email) {
            return 'Para criar paciente, informe também `phone` e `email`.';
          }
          const created = await patientRepo.create({
            doctorId: doctorId,
            name,
            phone,
            email,
            active: true,
          } as any);
          return `✅ Paciente criado com sucesso: ${created.name} (id: ${created.id}).`;
        }

        if (category === 'hospital') {
          if (!hospitalRepo || !doctorId)
            return 'Fluxo de hospital indisponível.';
          const existing = await hospitalRepo.findOne({
            name,
            doctorId: doctorId,
          } as any);
          if (existing) {
            return `Hospital já cadastrado: ${existing.name} (id: ${existing.id}).`;
          }
          const created = await hospitalRepo.create({
            doctorId: doctorId,
            name,
            phone: asNonEmptyString(args.phone) || undefined,
            email: asNonEmptyString(args.email) || undefined,
            active: true,
          } as any);
          return `✅ Hospital criado com sucesso: ${created.name} (id: ${created.id}).`;
        }

        if (category === 'healthPlan') {
          if (!healthPlanRepo || !doctorId)
            return 'Fluxo de convênio indisponível.';
          const phone = asNonEmptyString(args.phone);
          const email = asNonEmptyString(args.email);
          if (!phone || !email) {
            return 'Para criar convênio, informe também `phone` e `email`.';
          }
          const existing = await healthPlanRepo.findOne({
            name,
            doctorId: doctorId,
          } as any);
          if (existing) {
            return `Convênio já cadastrado: ${existing.name} (id: ${existing.id}).`;
          }
          const created = await healthPlanRepo.create({
            doctorId: doctorId,
            name,
            phone,
            email,
            active: true,
          } as any);
          return `✅ Convênio criado com sucesso: ${created.name} (id: ${created.id}).`;
        }

        if (category === 'procedure') {
          if (!procedureRepo) return 'Fluxo de procedimento indisponível.';
          const created = await procedureRepo.create({ name } as any);
          return `✅ Procedimento criado com sucesso: ${created.name} (id: ${created.id}).`;
        }

        if (category === 'template') {
          const templateData =
            args.templateData && typeof args.templateData === 'object'
              ? args.templateData
              : {};
          const created = await surgeryRequestsService.createTemplate(
            {
              name,
              templateData: templateData,
            },
            context.userId as string,
          );
          return `✅ Modelo criado com sucesso: ${created.name} (id: ${created.id}).`;
        }

        return 'Categoria inválida. Use: patient, hospital, healthPlan, procedure ou template.';
      } catch (err: any) {
        return `Erro ao criar registro da categoria ${category}: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const createSurgeryRequestFromWhatsapp: AiTool = {
    name: 'create_surgery_request_from_whatsapp',
    definition: {
      type: 'function',
      function: {
        name: 'create_surgery_request_from_whatsapp',
        description:
          'Cria uma nova solicitação cirúrgica a partir do WhatsApp, seguindo os campos do wizard web. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            doctorId: {
              type: 'string',
              description:
                'ID do médico dono da solicitação (opcional se o usuário tiver apenas um médico acessível).',
            },
            patientId: {
              type: 'string',
              description: 'ID do paciente já existente (opcional).',
            },
            patient_name: {
              type: 'string',
              description:
                'Nome do paciente. Obrigatório quando `patientId` não for informado.',
            },
            procedureId: {
              type: 'string',
              description:
                'ID do procedimento. Informe este campo ou `procedure_name`.',
            },
            procedure_name: {
              type: 'string',
              description:
                'Nome do procedimento para busca no catálogo. Informe este campo ou `procedureId`.',
            },
            priority: {
              type: 'number',
              description: 'Prioridade: 1=Baixa, 2=Média, 3=Alta, 4=Urgente.',
            },
            healthPlanId: {
              type: 'string',
              description: 'ID do convênio já existente (opcional).',
            },
            health_plan_name: {
              type: 'string',
              description: 'Nome do convênio para vincular/criar (opcional).',
            },
            hospitalId: {
              type: 'string',
              description: 'ID do hospital já existente (opcional).',
            },
            hospital_name: {
              type: 'string',
              description: 'Nome do hospital para vincular/criar (opcional).',
            },
            requiredDocuments: {
              type: 'array',
              description: 'Documentos obrigatórios iniciais (opcional).',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  name: { type: 'string' },
                },
                required: ['type', 'name'],
              },
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a criação. Caso contrário, mostra preview.',
            },
          },
          required: [],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context): Promise<string> {
      const buildGuidedMissingDataMessage = (
        missingKeys: string[],
        doctorOptions?: string[],
      ): string => {
        const lines: string[] = [
          'Para criar a solicitação via WhatsApp, faltam alguns dados obrigatórios:',
        ];

        for (const key of missingKeys) {
          switch (key) {
            case 'doctorId':
              lines.push('• doctorId: informe o médico responsável.');
              break;
            case 'procedure':
              lines.push(
                '• procedimento: informe `procedureId` ou `procedure_name`.',
              );
              break;
            case 'patient_id_or_name':
              lines.push('• paciente: informe `patientId` ou `patient_name`.');
              break;
          }
        }

        if (doctorOptions?.length) {
          lines.push(`• Médicos disponíveis: ${doctorOptions.join(', ')}.`);
        }

        lines.push(
          'Dica: posso listar categorias e registros cadastrados para você escolher (pacientes, procedimentos, convênios, hospitais, médicos e modelos).',
        );
        lines.push(
          'Se faltar algum cadastro, também posso criar o registro antes de concluir a solicitação.',
        );
        lines.push(
          'Quando estiver completo, eu envio a prévia e depois você confirma com "sim".',
        );
        return lines.join('\n');
      };

      if (!context.userId) return 'Acesso negado.';
      if (!patientRepo || !procedureRepo) {
        return 'Fluxo de criação indisponível no momento.';
      }

      const doctorIdRaw = asNonEmptyString(args.doctorId);
      const hasSingleDoctor = context.accessibleDoctorIds.length === 1;
      const doctorId =
        doctorIdRaw ||
        (hasSingleDoctor ? context.accessibleDoctorIds[0] : null);
      if (!doctorId) {
        return buildGuidedMissingDataMessage(
          ['doctorId'],
          context.accessibleDoctorIds,
        );
      }
      if (!context.accessibleDoctorIds.includes(doctorId)) {
        return 'Você não tem permissão para criar solicitação para esse médico.';
      }

      const priority = isValidPriority(args.priority)
        ? (Number(args.priority) as SurgeryRequestPriority)
        : SurgeryRequestPriority.LOW;

      const procedureIdArg = asNonEmptyString(args.procedureId);
      const procedureNameArg = asNonEmptyString(args.procedure_name);

      if (!procedureIdArg && !procedureNameArg) {
        return buildGuidedMissingDataMessage(['procedure']);
      }

      let procedure = null as any;
      if (procedureIdArg) {
        procedure = await procedureRepo.findOne({ id: procedureIdArg } as any);
      } else if (procedureNameArg) {
        procedure = await procedureRepo.findOne({
          name: procedureNameArg,
        } as any);

        if (!procedure) {
          const allProcedures = await procedureRepo.findMany({} as any, 0, 500);
          const normalizedInput = normalizeText(procedureNameArg);
          procedure = allProcedures.find((item) => {
            const normalizedName = normalizeText(item.name);
            return (
              normalizedInput &&
              normalizedName &&
              (normalizedName === normalizedInput ||
                normalizedName.includes(normalizedInput) ||
                normalizedInput.includes(normalizedName))
            );
          });
        }
      }

      if (!procedure) {
        return 'Procedimento não encontrado. Informe um `procedureId` válido ou um nome existente no catálogo.';
      }

      let patient = null as any;
      const patientIdArg = asNonEmptyString(args.patientId);
      if (patientIdArg) {
        patient = await patientRepo.findOne({
          id: patientIdArg,
          doctorId: doctorId,
        } as any);
        if (!patient) {
          return 'Paciente não encontrado para este médico. Verifique `patientId`.';
        }
      }

      const patientNameArg = asNonEmptyString(args.patient_name);

      if (!patient && !patientNameArg) {
        return buildGuidedMissingDataMessage(['patient_id_or_name']);
      }

      if (!patient && patientNameArg) {
        const candidates = await patientRepo.findMany(
          { doctorId: doctorId } as any,
          0,
          200,
        );
        const normalizedName = normalizeText(patientNameArg);
        patient = candidates.find((item) => {
          const itemName = normalizeText(item.name);
          return itemName === normalizedName;
        });

        if (!patient) {
          return 'Paciente não encontrado nos cadastrados do médico. Informe `patientId` válido ou o nome exato de um paciente existente.';
        }
      }

      const hospitalIdArg = asNonEmptyString(args.hospitalId);
      const hospitalNameArg = asNonEmptyString(args.hospital_name);
      let hospital = null as any;
      if (hospitalIdArg) {
        if (!hospitalRepo) return 'Fluxo de hospital indisponível no momento.';
        hospital = await hospitalRepo.findOne({
          id: hospitalIdArg,
          doctorId: doctorId,
        } as any);
        if (!hospital) {
          return 'Hospital não encontrado para este médico. Verifique `hospitalId`.';
        }
      } else if (hospitalNameArg) {
        if (!hospitalRepo) return 'Fluxo de hospital indisponível no momento.';
        hospital = await hospitalRepo.findOne({
          name: hospitalNameArg,
          doctorId: doctorId,
        } as any);

        if (!hospital) {
          return 'Hospital não encontrado para este médico. Informe `hospitalId` ou nome exato de um hospital cadastrado.';
        }
      }

      const healthPlanIdArg = asNonEmptyString(args.healthPlanId);
      const healthPlanNameArg = asNonEmptyString(args.health_plan_name);
      let healthPlan = null as any;
      if (healthPlanIdArg) {
        if (!healthPlanRepo)
          return 'Fluxo de convênio indisponível no momento.';
        healthPlan = await healthPlanRepo.findOne({
          id: healthPlanIdArg,
          doctorId: doctorId,
        } as any);
        if (!healthPlan) {
          return 'Convênio não encontrado para este médico. Verifique `healthPlanId`.';
        }
      } else if (healthPlanNameArg) {
        if (!healthPlanRepo)
          return 'Fluxo de convênio indisponível no momento.';
        healthPlan = await healthPlanRepo.findOne({
          name: healthPlanNameArg,
          doctorId: doctorId,
        } as any);

        if (!healthPlan) {
          return 'Convênio não encontrado para este médico. Informe `healthPlanId` ou nome exato de um convênio cadastrado.';
        }
      }

      let requiredDocuments: Array<{ type: string; name: string }> | undefined;
      if (args.requiredDocuments !== undefined) {
        if (!Array.isArray(args.requiredDocuments)) {
          return 'Parâmetro inválido: `requiredDocuments` deve ser um array.';
        }

        requiredDocuments = [];
        for (const item of args.requiredDocuments) {
          const type = asNonEmptyString(item?.type);
          const name = asNonEmptyString(item?.name);
          if (!type || !name) {
            return 'Parâmetro inválido: cada item de `requiredDocuments` deve conter `type` e `name`.';
          }
          requiredDocuments.push({ type, name });
        }
      }

      const patientLabel = patient
        ? `${patient.name} (existente)`
        : `${patientNameArg || 'Não informado'}`;
      const hospitalLabel = hospital
        ? `${hospital.name} (existente)`
        : hospitalNameArg
          ? hospitalNameArg
          : 'Não informado';
      const healthPlanLabel = healthPlan
        ? `${healthPlan.name} (existente)`
        : healthPlanNameArg
          ? healthPlanNameArg
          : 'Não informado';

      if (!args.confirm) {
        return [
          'Pré-visualização da nova solicitação:',
          `• Paciente: ${patientLabel}`,
          `• Procedimento: ${procedure.name}`,
          `• Prioridade: ${priorityLabel(priority)}`,
          `• Hospital: ${hospitalLabel}`,
          `• Convênio: ${healthPlanLabel}`,
          `• Documentos obrigatórios: ${requiredDocuments?.length || 0}`,
          'Confirme com "sim" para criar.',
        ].join('\n');
      }

      if (!patient) {
        return 'Paciente obrigatório não identificado. Se necessário, cadastre o paciente antes e me informe `patientId` ou `patient_name` exato.';
      }

      if (!hospital && hospitalNameArg) {
        return 'Hospital informado não foi encontrado. Informe `hospitalId` ou remova o hospital para criar sem esse vínculo.';
      }

      if (!healthPlan && healthPlanNameArg) {
        return 'Convênio informado não foi encontrado. Informe `healthPlanId` ou remova o convênio para criar sem esse vínculo.';
      }

      try {
        const created = await surgeryRequestsService.createSurgeryRequest(
          {
            doctorId: doctorId,
            patientId: patient.id,
            procedureId: procedure.id,
            priority,
            hospitalId: hospital?.id,
            healthPlanId: healthPlan?.id,
            requiredDocuments: requiredDocuments,
          },
          context.userId as string,
        );

        await activityRepo.create({
          surgeryRequestId: created.id,
          userId: context.userId as string,
          type: ActivityType.SYSTEM,
          content:
            '[WhatsApp IA] Solicitação criada via assistente no WhatsApp.',
        });

        const validation = pendencyValidator
          ? await pendencyValidator.validateForStatus(created.id)
          : null;
        const blockingPendencies =
          validation?.pendencies
            ?.filter((p) => !p.isComplete && !p.isOptional)
            .map((p) => p.name)
            .filter(Boolean) || [];

        const persistedRequest = await surgeryRequestRepo.findOneSimple({
          id: created.id,
        } as any);
        const protocol = normalizeProtocolDisplay(
          persistedRequest?.protocol ?? created.protocol,
        );
        const pendencyText = blockingPendencies.length
          ? blockingPendencies.map((name) => `  - ${name}`).join('\n')
          : '  - Nenhuma pendência bloqueante no status atual.';

        return [
          '✅ A solicitação cirúrgica foi criada com sucesso!',
          `• Código SC: ${protocol}`,
          `• Paciente: ${patient.name}`,
          '• Pendências para passar para o próximo status:',
          pendencyText,
        ].join('\n');
      } catch (err: any) {
        return `Erro ao criar solicitação: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  return [
    listScCreationCatalog,
    createScCatalogRecord,
    createSurgeryRequestFromWhatsapp,
    confirmDate,
    updateDateOptions,
    rescheduleSurgery,
    markPerformed,
    invoiceRequest,
    confirmReceipt,
    contestAuthorizationFull,
    contestPayment,
    updateReceipt,
    manageReportSections,
    setHospital,
    addTussItem,
    addOpmeItem,
    updateRequestClinicalData,
    updateRequestAdminData,
    attachDocumentFromWhatsapp,
  ];
}
