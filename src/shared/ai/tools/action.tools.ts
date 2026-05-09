import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../database/repositories/surgery-request-activity.repository';
import { SurgeryRequestWorkflowService } from '../../../modules/surgery-requests/services/surgery-request-workflow.service';
import { SurgeryRequestMutationService } from '../../../modules/surgery-requests/services/surgery-request-mutation.service';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { ActivityType } from '../../../database/entities/surgery-request-activity.entity';
import { SurgeryRequestPriority } from '../../../database/entities/surgery-request.entity';
import { PatientRepository } from '../../../database/repositories/patient.repository';
import { detokenizeArg } from '../pii/tool-pii-helpers';

const STATUS_LABELS: Record<number, string> = {
  1: 'Pendente',
  2: 'Enviada',
  3: 'Em Análise',
  4: 'Em Agendamento',
  5: 'Agendada',
  6: 'Realizada',
  7: 'Faturada',
  8: 'Finalizada',
  9: 'Encerrada',
};

const NEXT_STATUS: Record<number, number> = {
  1: 2,
  2: 3,
  3: 4,
  4: 5,
  5: 6,
  6: 7,
  7: 8,
};

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

async function resolveAuthorizedRequest(
  surgeryRequestRepo: SurgeryRequestRepository,
  identifierRaw: unknown,
  context: ToolContext,
): Promise<{ request: any | null; error: string | null }> {
  const identifier = sanitizeIdentifier(identifierRaw);
  if (!identifier) {
    return {
      request: null,
      error: 'Parâmetro inválido: informe a solicitação.',
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
    return { request: null, error: 'Solicitação não encontrada.' };
  }

  if (!context.accessibleDoctorIds.includes(request.doctor_id)) {
    return {
      request: null,
      error: 'Você não tem permissão para acessar essa solicitação.',
    };
  }

  return { request, error: null };
}

export function buildActionTools(
  surgeryRequestRepo: SurgeryRequestRepository,
  workflowService: SurgeryRequestWorkflowService,
  mutationService: SurgeryRequestMutationService,
  pendencyValidator: PendencyValidatorService,
  activityRepo: SurgeryRequestActivityRepository,
  patientRepo: PatientRepository,
): AiTool[] {
  const advanceSurgeryRequest: AiTool = {
    name: 'advance_surgery_request',
    definition: {
      type: 'function',
      function: {
        name: 'advance_surgery_request',
        description:
          'Avança uma solicitação cirúrgica para a próxima etapa do fluxo. Só funciona se todas as pendências bloqueantes estiverem resolvidas. IMPORTANTE: sempre pergunte ao usuário se ele confirma antes de executar.',
        parameters: {
          type: 'object',
          properties: {
            surgery_request_id: {
              type: 'string',
              description:
                'Identificador da solicitação. Aceita UUID, protocolo (SC-XXXX) ou apenas o número do protocolo (XXXX).',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, executa a transição. Se false ou omitido, apenas mostra o que seria feito.',
            },
            selected_date_index: {
              type: 'number',
              description:
                'Opcional no avanço 4->5. Índice da data (0, 1 ou 2).',
            },
            surgery_performed_at: {
              type: 'string',
              description:
                'Opcional no avanço 5->6. Data de realização em formato ISO.',
            },
            invoice_protocol: {
              type: 'string',
              description:
                'Necessário no avanço 6->7 quando não houver protocolo definido.',
            },
            invoice_value: {
              type: 'number',
              description:
                'Necessário no avanço 6->7 quando não houver valor da fatura definido.',
            },
            invoice_sent_at: {
              type: 'string',
              description:
                'Opcional no avanço 6->7. Data de envio da fatura em formato ISO.',
            },
            received_value: {
              type: 'number',
              description:
                'Opcional no avanço 7->8. Valor recebido. Se omitido, tenta usar valor da fatura.',
            },
            received_at: {
              type: 'string',
              description:
                'Opcional no avanço 7->8. Data do recebimento em formato ISO.',
            },
          },
          required: ['surgery_request_id'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId)
        return 'Você precisa estar cadastrado para executar esta ação.';

      const auth = await resolveAuthorizedRequest(
        surgeryRequestRepo,
        args.surgery_request_id,
        context,
      );
      if (!auth.request) return auth.error as string;

      const request = auth.request;
      const requestId = request.id as string;
      const detailedRequest = await surgeryRequestRepo.findOne({
        id: requestId,
      });

      const canAdvance = await pendencyValidator.canAdvance(requestId);
      const currentLabel =
        STATUS_LABELS[request.status] || String(request.status);
      const nextStatus = NEXT_STATUS[request.status];
      const nextLabel = nextStatus ? STATUS_LABELS[nextStatus] : null;

      if (!canAdvance) {
        return `A solicitação ${request.protocol} ainda tem pendências bloqueantes e não pode avançar. Consulte as pendências com "get_pendencies".`;
      }

      if (!nextLabel) {
        return `A solicitação ${request.protocol} já está no status final: ${currentLabel}.`;
      }

      if (!args.confirm) {
        return `A solicitação *${request.protocol}* será avançada de *${currentLabel}* para *${nextLabel}*.\n\nDeseja confirmar? Responda "sim" para prosseguir.`;
      }

      try {
        switch (request.status) {
          case 1:
            await workflowService.sendRequest(
              requestId,
              {} as any,
              context.userId,
            );
            break;
          case 2:
            await workflowService.startAnalysis(
              requestId,
              {} as any,
              context.userId,
            );
            break;
          case 3:
            await workflowService.acceptAuthorization(
              requestId,
              {} as any,
              context.userId,
            );
            break;
          case 4: {
            const selectedDateIndex =
              typeof args.selected_date_index === 'number'
                ? args.selected_date_index
                : detailedRequest?.selected_date_index;

            if (
              !Number.isInteger(selectedDateIndex) ||
              ![0, 1, 2].includes(selectedDateIndex as number)
            ) {
              return 'Para avançar de Em Agendamento para Agendada, informe `selected_date_index` (0, 1 ou 2) ou confirme a data antes com `confirm_date`.';
            }

            await workflowService.confirmDate(
              requestId,
              { selected_date_index: selectedDateIndex as number } as any,
              context.userId,
            );
            break;
          }
          case 5: {
            const performedAtRaw =
              typeof args.surgery_performed_at === 'string' &&
              !Number.isNaN(new Date(args.surgery_performed_at).getTime())
                ? args.surgery_performed_at
                : detailedRequest?.surgery_date
                  ? new Date(detailedRequest.surgery_date).toISOString()
                  : new Date().toISOString();

            await workflowService.markPerformed(
              requestId,
              { surgery_performed_at: performedAtRaw } as any,
              context.userId,
            );
            break;
          }
          case 6: {
            const invoiceProtocol =
              typeof args.invoice_protocol === 'string' &&
              args.invoice_protocol.trim().length
                ? args.invoice_protocol.trim()
                : '';
            const invoiceValue =
              typeof args.invoice_value === 'number' &&
              Number.isFinite(args.invoice_value) &&
              args.invoice_value >= 0
                ? args.invoice_value
                : null;
            const invoiceSentAt =
              typeof args.invoice_sent_at === 'string' &&
              !Number.isNaN(new Date(args.invoice_sent_at).getTime())
                ? args.invoice_sent_at
                : new Date().toISOString();

            if (!invoiceProtocol || invoiceValue === null) {
              return 'Para avançar de Realizada para Faturada, informe `invoice_protocol` e `invoice_value`.';
            }

            await workflowService.invoiceRequest(
              requestId,
              {
                invoice_protocol: invoiceProtocol,
                invoice_value: invoiceValue,
                invoice_sent_at: invoiceSentAt,
              } as any,
              context.userId,
            );
            break;
          }
          case 7: {
            const billedValue =
              detailedRequest?.billing?.invoice_value != null
                ? Number(detailedRequest.billing.invoice_value)
                : null;
            const receivedValue =
              typeof args.received_value === 'number' &&
              Number.isFinite(args.received_value) &&
              args.received_value >= 0
                ? args.received_value
                : billedValue;
            const receivedAt =
              typeof args.received_at === 'string' &&
              !Number.isNaN(new Date(args.received_at).getTime())
                ? args.received_at
                : new Date().toISOString();

            if (receivedValue === null) {
              return 'Para avançar de Faturada para Finalizada, informe `received_value` (ou registre faturamento com valor).';
            }

            await workflowService.confirmReceipt(
              requestId,
              {
                received_value: receivedValue,
                received_at: receivedAt,
              } as any,
              context.userId,
            );
            break;
          }
          default:
            return `Avanço automático para o status ${nextLabel} não suportado via WhatsApp. Acesse a plataforma web.`;
        }
        await activityRepo.create({
          surgery_request_id: requestId,
          user_id: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Solicitação avançada de "${currentLabel}" para "${nextLabel}".`,
        });
        return `Solicitação *${request.protocol}* avançada de *${currentLabel}* para *${nextLabel}* com sucesso.`;
      } catch (err: any) {
        return `Erro ao avançar a solicitação: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const setHasOpme: AiTool = {
    name: 'set_has_opme',
    definition: {
      type: 'function',
      function: {
        name: 'set_has_opme',
        description: 'Define se a solicitação possui OPME.',
        parameters: {
          type: 'object',
          properties: {
            surgery_request_id: {
              type: 'string',
              description:
                'Identificador da solicitação. Aceita UUID, protocolo (SC-XXXX) ou apenas o número do protocolo (XXXX).',
            },
            has_opme: {
              type: 'boolean',
              description: 'True se possui OPME, false caso contrário',
            },
            confirm: {
              type: 'boolean',
              description: 'Confirmação do usuário',
            },
          },
          required: ['surgery_request_id', 'has_opme'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const auth = await resolveAuthorizedRequest(
        surgeryRequestRepo,
        args.surgery_request_id,
        context,
      );
      if (!auth.request) return auth.error as string;
      const request = auth.request;
      const requestId = request.id as string;

      if (!args.confirm) {
        return `Deseja ${args.has_opme ? 'marcar' : 'desmarcar'} a solicitação ${request.protocol} como ${args.has_opme ? 'possuindo' : 'não possuindo'} OPME? Confirme com "sim".`;
      }

      await mutationService.setHasOpme(
        requestId,
        args.has_opme as boolean,
        context.userId,
      );

      await activityRepo.create({
        surgery_request_id: requestId,
        user_id: context.userId,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] OPME definido como: ${args.has_opme ? 'Sim' : 'Não'}.`,
      });

      return `✅ Solicitação ${request.protocol} atualizada: OPME = ${args.has_opme ? 'Sim' : 'Não'}.`;
    },
  };

  const closeSurgeryRequest: AiTool = {
    name: 'close_surgery_request',
    definition: {
      type: 'function',
      function: {
        name: 'close_surgery_request',
        description:
          'Encerra (cancela) uma solicitação cirúrgica. Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgery_request_id: {
              type: 'string',
              description:
                'Identificador da solicitação. Aceita UUID, protocolo (SC-XXXX) ou apenas o número do protocolo (XXXX).',
            },
            reason: {
              type: 'string',
              description: 'Motivo do encerramento',
            },
            confirm: {
              type: 'boolean',
              description: 'Confirmação explícita do usuário',
            },
          },
          required: ['surgery_request_id', 'reason'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const auth = await resolveAuthorizedRequest(
        surgeryRequestRepo,
        args.surgery_request_id,
        context,
      );
      if (!auth.request) return auth.error as string;
      const request = auth.request;
      const requestId = request.id as string;

      if (!args.confirm) {
        return `⚠️ Você está prestes a *encerrar* a solicitação ${request.protocol}.\nMotivo: "${args.reason}"\n\nEssa ação não pode ser desfeita. Confirme com "sim".`;
      }

      try {
        await workflowService.closeSurgeryRequest(
          requestId,
          { reason: args.reason as string } as any,
          context.userId,
        );
        await activityRepo.create({
          surgery_request_id: requestId,
          user_id: context.userId,
          type: ActivityType.SYSTEM,
          content: `[WhatsApp IA] Solicitação encerrada. Motivo: "${args.reason}".`,
        });
        return `✅ Solicitação ${request.protocol} encerrada com sucesso.`;
      } catch (err: any) {
        return `Erro ao encerrar: ${err?.message || 'erro desconhecido'}`;
      }
    },
  };

  const PRIORITY_LABELS: Record<number, string> = {
    1: 'Baixa',
    2: 'Média',
    3: 'Alta',
    4: 'Urgente',
  };

  const updateSurgeryRequestData: AiTool = {
    name: 'update_surgery_request_data',
    definition: {
      type: 'function',
      function: {
        name: 'update_surgery_request_data',
        description:
          'Atualiza dados básicos de uma solicitação cirúrgica: prioridade. IMPORTANTE: sempre confirme com o usuário antes de executar.',
        parameters: {
          type: 'object',
          properties: {
            surgery_request_id: {
              type: 'string',
              description:
                'Identificador da solicitação. Aceita UUID, protocolo (SC-XXXX) ou apenas o número do protocolo (XXXX).',
            },
            priority: {
              type: 'number',
              description: 'Prioridade: 1=Baixa, 2=Média, 3=Alta, 4=Urgente',
            },
            confirm: {
              type: 'boolean',
              description:
                'Se true, aplica as alterações. Se false/omitido, apenas mostra o preview.',
            },
          },
          required: ['surgery_request_id'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const auth = await resolveAuthorizedRequest(
        surgeryRequestRepo,
        args.surgery_request_id,
        context,
      );
      if (!auth.request) return auth.error as string;
      const request = auth.request;
      const requestId = request.id as string;

      if (
        args.priority !== undefined &&
        ![1, 2, 3, 4].includes(args.priority as number)
      ) {
        return 'Prioridade inválida. Use 1=Baixa, 2=Média, 3=Alta, 4=Urgente.';
      }

      const changes: string[] = [];
      if (args.priority !== undefined) {
        changes.push(`Prioridade: ${PRIORITY_LABELS[args.priority as number]}`);
      }

      if (!changes.length) {
        return 'Nenhuma alteração especificada. Informe ao menos a prioridade.';
      }

      if (!args.confirm) {
        return `Você deseja atualizar a solicitação *${request.protocol}* com:\n${changes.map((c) => `• ${c}`).join('\n')}\n\nConfirme com "sim".`;
      }

      await mutationService.updateBasic(
        {
          id: requestId,
          priority: args.priority as SurgeryRequestPriority | undefined,
        },
        context.userId,
      );

      await activityRepo.create({
        surgery_request_id: requestId,
        user_id: context.userId,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Dados atualizados: ${changes.join(', ')}.`,
      });

      return `✅ Solicitação *${request.protocol}* atualizada:\n${changes.map((c) => `• ${c}`).join('\n')}`;
    },
  };

  const updatePatientData: AiTool = {
    name: 'update_patient_data',
    definition: {
      type: 'function',
      function: {
        name: 'update_patient_data',
        description:
          'Atualiza dados cadastrais do paciente vinculado a uma solicitação (nome, data de nascimento, CPF, telefone, endereço e CEP). Requer confirmação explícita.',
        parameters: {
          type: 'object',
          properties: {
            surgery_request_id: {
              type: 'string',
              description:
                'ID/Protocolo da solicitação (UUID, SC-XXXX ou XXXX)',
            },
            name: { type: 'string', description: 'Nome do paciente' },
            birth_date: {
              type: 'string',
              description: 'Data de nascimento no formato YYYY-MM-DD',
            },
            cpf: { type: 'string', description: 'CPF do paciente' },
            phone: { type: 'string', description: 'Telefone do paciente' },
            address: { type: 'string', description: 'Endereço do paciente' },
            zip_code: { type: 'string', description: 'CEP do paciente' },
            confirm: {
              type: 'boolean',
              description:
                'Se true, aplica as alterações. Se false/omitido, apenas mostra preview.',
            },
          },
          required: ['surgery_request_id'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const auth = await resolveAuthorizedRequest(
        surgeryRequestRepo,
        args.surgery_request_id,
        context,
      );
      if (!auth.request) return auth.error as string;

      const request = auth.request;
      if (!request.patient_id) {
        return 'Não foi possível localizar o paciente vinculado a esta solicitação.';
      }

      const updates: Record<string, any> = {};
      const changes: string[] = [];

      if (args.name !== undefined) {
        const v = String(detokenizeArg(context, args.name) ?? '').trim();
        if (!v) return 'Parâmetro inválido: `name` não pode ser vazio.';
        updates.name = v;
        changes.push(`Nome: ${v}`);
      }

      if (args.birth_date !== undefined) {
        const raw = String(
          detokenizeArg(context, args.birth_date) ?? '',
        ).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          return 'Parâmetro inválido: `birth_date` deve estar em YYYY-MM-DD.';
        }
        updates.birth_date = raw;
        changes.push(`Data de nascimento: ${raw}`);
      }

      if (args.cpf !== undefined) {
        const v = String(detokenizeArg(context, args.cpf) ?? '').trim();
        if (!v) return 'Parâmetro inválido: `cpf` não pode ser vazio.';
        updates.cpf = v;
        changes.push(`CPF: ${v}`);
      }

      if (args.phone !== undefined) {
        const v = String(detokenizeArg(context, args.phone) ?? '').trim();
        if (!v) return 'Parâmetro inválido: `phone` não pode ser vazio.';
        updates.phone = v;
        changes.push(`Telefone: ${v}`);
      }

      if (args.address !== undefined) {
        const v = String(detokenizeArg(context, args.address) ?? '').trim();
        if (!v) return 'Parâmetro inválido: `address` não pode ser vazio.';
        updates.address = v;
        changes.push(`Endereço: ${v}`);
      }

      if (args.zip_code !== undefined) {
        const v = String(detokenizeArg(context, args.zip_code) ?? '').trim();
        if (!v) return 'Parâmetro inválido: `zip_code` não pode ser vazio.';
        updates.zip_code = v;
        changes.push(`CEP: ${v}`);
      }

      if (!changes.length) {
        return 'Nenhuma alteração informada. Envie ao menos um campo para atualizar.';
      }

      if (!args.confirm) {
        return `A solicitação ${request.protocol} terá os dados do paciente atualizados com:\n${changes.map((c) => `• ${c}`).join('\n')}\n\nConfirme com "sim" para executar.`;
      }

      await patientRepo.update(request.patient_id, updates);

      await activityRepo.create({
        surgery_request_id: request.id,
        user_id: context.userId,
        type: ActivityType.SYSTEM,
        content: `[WhatsApp IA] Dados do paciente atualizados: ${changes.join(', ')}.`,
      });

      return `Dados do paciente da solicitação ${request.protocol} atualizados com sucesso.`;
    },
  };

  return [
    advanceSurgeryRequest,
    setHasOpme,
    closeSurgeryRequest,
    updateSurgeryRequestData,
    updatePatientData,
  ];
}
