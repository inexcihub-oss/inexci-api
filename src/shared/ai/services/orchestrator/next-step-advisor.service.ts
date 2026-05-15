import { Injectable, Logger } from '@nestjs/common';
import { SurgeryRequestRepository } from '../../../../database/repositories/surgery-request.repository';
import { PendencyValidatorService } from '../../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { ToolContext } from '../../tools/tool.interface';

const MUTATION_TOOL_NAMES = new Set<string>([
  'advance_surgery_request',
  'set_has_opme',
  'close_surgery_request',
  'reschedule_surgery',
  'confirm_receipt',
  'update_receipt',
  'manage_report_sections',
  'set_hospital',
  'add_tuss_item',
  'add_opme_item',
  'attach_document_from_whatsapp',
  'create_patient_from_document',
]);

@Injectable()
export class NextStepAdvisorService {
  private readonly logger = new Logger(NextStepAdvisorService.name);

  constructor(
    private readonly surgeryRequestRepo: SurgeryRequestRepository,
    private readonly pendencyValidator: PendencyValidatorService,
  ) {}

  async appendNextStep(
    toolName: string,
    args: Record<string, unknown>,
    toolOutput: string,
    context: ToolContext,
  ): Promise<string> {
    if (!MUTATION_TOOL_NAMES.has(toolName)) return toolOutput;
    if (args.confirm !== true) return toolOutput;
    if (!this.isSuccessfulMutation(toolOutput)) return toolOutput;

    const requestId =
      typeof args.surgeryRequestId === 'string'
        ? args.surgeryRequestId
        : typeof args.id === 'string'
          ? args.id
          : '';

    if (!requestId) return toolOutput;

    try {
      const request = await this.surgeryRequestRepo.findOneSimple({
        id: requestId,
      });
      if (!request) return toolOutput;
      if (!context.accessibleDoctorIds.includes(request.doctorId)) {
        return toolOutput;
      }

      const validation =
        await this.pendencyValidator.validateForStatus(requestId);
      const pending = validation.pendencies.filter(
        (item) => !item.isComplete && !item.isOptional,
      );

      if (!pending.length) {
        return `${toolOutput}\n\nPróximo passo recomendado:\nA solicitação está sem pendências bloqueantes. Posso executar advance_surgery_request com confirm=true.`;
      }

      const next = pending[0];
      const recommendation = this.mapPendencyToAction(next.key);
      return `${toolOutput}\n\nPróximo passo recomendado:\nPendência atual: ${next.name}.\nAção recomendada: ${recommendation.action}.\nParâmetros mínimos: ${recommendation.minParams.join(', ')}.\nDeseja que eu execute essa ação agora?`;
    } catch {
      return toolOutput;
    }
  }

  private isSuccessfulMutation(output: string): boolean {
    const text = (output || '').toLowerCase();
    if (!text.trim()) return false;

    const hasFailureSignal =
      text.includes('erro') ||
      text.includes('inválid') ||
      text.includes('não encontrada') ||
      text.includes('nao encontrada') ||
      text.includes('permissão') ||
      text.includes('acesso negado') ||
      text.includes('confirme com "sim"') ||
      text.includes('deseja confirmar');

    if (hasFailureSignal) return false;

    return (
      text.includes('sucesso') ||
      text.includes('criada') ||
      text.includes('atualizada') ||
      text.includes('confirmad') ||
      text.includes('registrad') ||
      text.includes('avançad') ||
      text.includes('marcada')
    );
  }

  private mapPendencyToAction(key: string): {
    action: string;
    minParams: string[];
  } {
    switch (key) {
      case 'patient_data':
        return {
          action:
            'plan_actions(intent="update_sc") + draft_update(update_sc, surgeryRequestId, ...) + draft_update(update_sc, scope, "patient") + draft_update(update_sc, changes, {...}) + update_sc_draft_commit',
          minParams: ['surgery_request_id_or_protocol', 'field', 'value'],
        };
      case 'hospital_data':
        return {
          action: 'set_hospital',
          minParams: ['surgeryRequestId', 'hospital_name'],
        };
      case 'tuss_procedures':
        return {
          action: 'add_tuss_item',
          minParams: ['surgeryRequestId', 'tussCode', 'name'],
        };
      case 'opme_items':
        return {
          action: 'set_has_opme ou add_opme_item',
          minParams: ['surgeryRequestId', 'hasOpme=true|false'],
        };
      case 'medical_report':
        return {
          action: 'manage_report_sections',
          minParams: ['surgeryRequestId', 'operation=create', 'title'],
        };
      case 'schedule_dates':
        return {
          action:
            'plan_actions(intent="scheduling") + draft_update(scheduling, surgeryRequestId, ...) + draft_update(scheduling, dateOptions, [...]) + scheduling_draft_commit',
          minParams: ['surgery_request_id_or_protocol', 'date_options[]'],
        };
      case 'confirm_date':
        return {
          action:
            'plan_actions(intent="scheduling") + draft_update(scheduling, surgeryRequestId, ...) + draft_update(scheduling, confirmedDate, ...) + scheduling_draft_commit',
          minParams: ['surgery_request_id_or_protocol', 'confirmed_date_index'],
        };
      case 'confirm_receipt':
        return {
          action: 'confirm_receipt',
          minParams: ['surgeryRequestId', 'receivedValue', 'receivedAt'],
        };
      default:
        if (key.startsWith('doc_')) {
          return {
            action: 'attach_document_from_whatsapp',
            minParams: ['surgeryRequestId', 'document_type?', 'confirm=true'],
          };
        }
        return {
          action: 'get_pendencies',
          minParams: ['surgeryRequestId'],
        };
    }
  }
}
