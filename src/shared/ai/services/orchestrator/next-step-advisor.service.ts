import { Injectable, Logger } from '@nestjs/common';
import { SurgeryRequestRepository } from '../../../../database/repositories/surgery-request.repository';
import { PendencyValidatorService } from '../../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { ToolContext } from '../../tools/tool.interface';
import { parseToolResult } from '../../tools/tool-result';
import { recommendActionForPendency } from '../../tools/helpers/pendency-actions';
import { resolveAuthorizedRequest } from '../../tools/helpers/surgery-request-access';
import { ToolRegistryService } from '../tool-registry.service';

@Injectable()
export class NextStepAdvisorService {
  private readonly logger = new Logger(NextStepAdvisorService.name);

  constructor(
    private readonly surgeryRequestRepo: SurgeryRequestRepository,
    private readonly pendencyValidator: PendencyValidatorService,
    private readonly toolRegistry: ToolRegistryService,
  ) {}

  async appendNextStep(
    toolName: string,
    args: Record<string, unknown>,
    toolOutput: string,
    context: ToolContext,
  ): Promise<string> {
    if (!this.toolRegistry.getTool(toolName)?.mutates) return toolOutput;
    if (args.confirm !== true) return toolOutput;
    if (!this.isSuccessfulMutation(toolOutput)) return toolOutput;

    const identifier = this.extractRequestIdentifier(args, toolOutput);
    if (!identifier) return toolOutput;

    try {
      const { request } = await resolveAuthorizedRequest(
        this.surgeryRequestRepo,
        identifier,
        context,
      );
      if (!request) return toolOutput;

      const validation = await this.pendencyValidator.validateForStatus(
        request.id,
      );
      const pending = validation.pendencies.filter(
        (item) => !item.isComplete && !item.isOptional,
      );

      if (!pending.length) {
        return `${toolOutput}\n\nPróximo passo recomendado:\nA solicitação está sem pendências bloqueantes. Posso executar advance_surgery_request com confirm=true.`;
      }

      const next = pending[0];
      const recommendation = recommendActionForPendency(
        next.key,
        (next.checkItems || []).filter((item) => !item.done),
      );
      return `${toolOutput}\n\nPróximo passo recomendado:\nPendência atual: ${next.name}.\nAção recomendada: ${recommendation.action}.\nParâmetros mínimos: ${recommendation.minParams.join(', ')}.\nDeseja que eu execute essa ação agora?`;
    } catch (err) {
      this.logger.debug(
        `[NEXT_STEP] falhou tool=${toolName} err=${(err as Error)?.message}`,
      );
      return toolOutput;
    }
  }

  private extractRequestIdentifier(
    args: Record<string, unknown>,
    toolOutput: string,
  ): string | null {
    if (typeof args.surgeryRequestId === 'string' && args.surgeryRequestId) {
      return args.surgeryRequestId;
    }
    if (typeof args.id === 'string' && args.id) return args.id;
    const affected = parseToolResult(toolOutput)?.affected ?? [];
    return affected.find((a) => a.kind === 'surgery_request')?.id ?? null;
  }

  private isSuccessfulMutation(output: string): boolean {
    const envelope = parseToolResult(output);
    if (envelope) return envelope.status === 'ok';

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
}
