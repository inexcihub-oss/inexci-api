import { Injectable } from '@nestjs/common';
import {
  PlannerOutput,
  RuntimeState,
  RuntimeWorkflow,
  SemanticInputEnvelope,
} from '../../contracts/agentic-architecture.contracts';

@Injectable()
export class InternalPlannerService {
  plan(input: {
    normalizedInput: string;
    semanticInput: SemanticInputEnvelope;
    runtimeState: RuntimeState;
  }): PlannerOutput {
    const { normalizedInput, semanticInput, runtimeState } = input;
    const lower = normalizedInput.toLowerCase();

    if (runtimeState.pendingConfirmation && this.isAffirmative(lower)) {
      return this.buildPlan({
        semanticInput,
        workflow: runtimeState.activeWorkflow,
        intent: 'confirm_pending_action',
        nextBestAction: 'Retomar a confirmacao pendente e executar a mesma operacao.',
        toolCandidate: runtimeState.pendingConfirmation.tool,
        missingFields: [],
        needsRetrieval: false,
        needsVision: false,
        confidence: 0.99,
        fallbackPlan: 'Se a confirmacao falhar, reexibir o preview da operacao pendente.',
      });
    }

    if (runtimeState.pendingDocument?.classification) {
      return this.buildPlan({
        semanticInput,
        workflow: 'document_intake',
        intent: runtimeState.pendingDocument.intent || 'process_document',
        nextBestAction:
          'Concluir o fluxo do documento pendente antes de abrir um novo fluxo.',
        toolCandidate: null,
        missingFields: runtimeState.missingFields,
        needsRetrieval: false,
        needsVision: false,
        confidence: 0.93,
        fallbackPlan:
          'Se o documento permanecer ambiguo, pedir confirmacao ou mais contexto ao usuario.',
      });
    }

    if (runtimeState.activeDraft) {
      return this.buildPlan({
        semanticInput,
        workflow: runtimeState.activeWorkflow,
        intent: `continue_${runtimeState.activeDraft}`,
        nextBestAction:
          runtimeState.missingFields.length > 0
            ? `Coletar o proximo campo obrigatorio do draft ${runtimeState.activeDraft}.`
            : `Preparar preview ou commit do draft ${runtimeState.activeDraft}.`,
        toolCandidate:
          runtimeState.missingFields.length > 0 ? 'draft_update' : 'draft_status',
        missingFields: runtimeState.missingFields,
        needsRetrieval: false,
        needsVision: false,
        confidence: 0.95,
        fallbackPlan:
          'Se o usuario mudar de assunto, pedir confirmacao antes de abandonar o draft ativo.',
      });
    }

    if (this.matchesAny(lower, ['criar solicitação', 'criar solicitacao', 'nova sc', 'criar sc'])) {
      return this.workflowPlan('create_sc', semanticInput, 'plan_actions');
    }
    if (this.matchesAny(lower, ['agendar', 'agendamento'])) {
      return this.workflowPlan('scheduling', semanticInput, 'plan_actions');
    }
    if (this.matchesAny(lower, ['fatura', 'faturar', 'invoice'])) {
      return this.workflowPlan('invoice', semanticInput, 'plan_actions');
    }
    if (this.matchesAny(lower, ['contest', 'contestação', 'contestacao'])) {
      return this.workflowPlan('contestation', semanticInput, 'plan_actions');
    }
    if (this.matchesAny(lower, ['pendencia', 'status', 'protocolo', 'minhas sc'])) {
      return this.buildPlan({
        semanticInput,
        workflow: 'search',
        intent: 'lookup_surgery_request',
        nextBestAction: 'Consultar ou listar as solicitacoes cirurgicas relevantes.',
        toolCandidate: 'query_surgery_requests',
        missingFields: [],
        needsRetrieval: false,
        needsVision: false,
        confidence: 0.8,
        fallbackPlan: 'Se faltar identificador, listar opcoes para o usuario escolher.',
      });
    }
    if (this.matchesAny(lower, ['como', 'posso', 'ajuda', 'duvida'])) {
      return this.buildPlan({
        semanticInput,
        workflow: 'faq',
        intent: 'faq',
        nextBestAction: 'Responder com apoio de retrieval seletivo da base.',
        toolCandidate: null,
        missingFields: [],
        needsRetrieval: true,
        retrievalCategory: 'faq',
        needsVision: false,
        confidence: 0.76,
        fallbackPlan: 'Se a base nao trouxer contexto suficiente, responder de forma conservadora.',
      });
    }

    return this.buildPlan({
      semanticInput,
      workflow: runtimeState.activeWorkflow === 'idle' ? 'unknown' : runtimeState.activeWorkflow,
      intent: 'unknown',
      nextBestAction: 'Esclarecer a intencao do usuario com a menor pergunta possivel.',
      toolCandidate: null,
      missingFields: runtimeState.missingFields,
      needsRetrieval: semanticInput.normalizedText.length >= 15,
      retrievalCategory: 'workflow',
      needsVision: false,
      confidence: 0.4,
      fallbackPlan:
        'Se continuar ambiguo, oferecer ate 3 proximos passos claros para desambiguacao.',
    });
  }

  private workflowPlan(
    workflow: RuntimeWorkflow,
    semanticInput: SemanticInputEnvelope,
    toolCandidate: string,
  ): PlannerOutput {
    return this.buildPlan({
      semanticInput,
      workflow,
      intent: workflow,
      nextBestAction: `Abrir ou retomar o fluxo ${workflow}.`,
      toolCandidate,
      missingFields: [],
      needsRetrieval: false,
      needsVision: false,
      confidence: 0.88,
      fallbackPlan:
        'Se o fluxo nao puder iniciar, retornar ao usuario apenas o dado minimo faltante.',
    });
  }

  private buildPlan(
    input: Omit<PlannerOutput, 'version' | 'entitiesDetected'> & {
      semanticInput: SemanticInputEnvelope;
    },
  ): PlannerOutput {
    return {
      version: '1.0',
      intent: input.intent,
      workflow: input.workflow,
      entitiesDetected: input.semanticInput.entities,
      missingFields: input.missingFields,
      nextBestAction: input.nextBestAction,
      toolCandidate: input.toolCandidate,
      needsRetrieval: input.needsRetrieval,
      retrievalCategory: input.retrievalCategory ?? null,
      needsVision: input.needsVision,
      confidence: input.confidence,
      fallbackPlan: input.fallbackPlan,
    };
  }

  private isAffirmative(text: string): boolean {
    return /^(sim|confirmo|ok|pode|pode sim|isso|1)\b/.test(text.trim());
  }

  private matchesAny(text: string, patterns: string[]): boolean {
    return patterns.some((pattern) => text.includes(pattern));
  }
}
