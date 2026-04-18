import OpenAI from 'openai';
import { AiTool, ToolContext } from './tool.interface';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';

export function buildPendencyTools(
  pendencyValidator: PendencyValidatorService,
  surgeryRequestRepo: SurgeryRequestRepository,
): AiTool[] {
  const getPendencies: AiTool = {
    name: 'get_pendencies',
    definition: {
      type: 'function',
      function: {
        name: 'get_pendencies',
        description:
          'Verifica todas as pendências de uma solicitação cirúrgica. Retorna o que falta para avançar para a próxima etapa.',
        parameters: {
          type: 'object',
          properties: {
            surgery_request_id: {
              type: 'string',
              description: 'ID da solicitação cirúrgica',
            },
          },
          required: ['surgery_request_id'],
        },
      },
    } as OpenAI.ChatCompletionTool,
    async execute(args, context: ToolContext): Promise<string> {
      if (!context.userId) return 'Acesso negado.';

      const request = await surgeryRequestRepo.findOneSimple({
        id: args.surgery_request_id as string,
      });

      if (!request) return 'Solicitação não encontrada.';
      if (!context.accessibleDoctorIds.includes(request.doctor_id)) {
        return 'Você não tem permissão para acessar essa solicitação.';
      }

      const result = await pendencyValidator.validateForStatus(
        args.surgery_request_id as string,
      );

      if (!result.pendencies.length) {
        return `✅ A solicitação não tem pendências. Pode avançar para a próxima etapa.`;
      }

      const pending = result.pendencies.filter((p) => !p.isComplete && !p.isOptional);
      const completed = result.pendencies.filter((p) => p.isComplete);

      const lines: string[] = [
        `📋 *Pendências — ${result.statusLabel}*`,
        `Status atual: ${result.statusLabel}`,
        `Pode avançar: ${result.canAdvance ? '✅ Sim' : '❌ Não'}`,
        '',
      ];

      if (pending.length) {
        lines.push('*Pendente:*');
        lines.push(...pending.map((p) => `• ❌ ${p.name}`));
      }

      if (completed.length) {
        lines.push('*Concluído:*');
        lines.push(...completed.map((p) => `• ✅ ${p.name}`));
      }

      return lines.join('\n');
    },
  };

  return [getPendencies];
}
