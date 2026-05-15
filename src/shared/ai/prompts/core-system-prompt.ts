import {
  PlannerOutput,
  RuntimeState,
} from '../contracts/agentic-architecture.contracts';

export const CORE_SYSTEM_PROMPT_VERSION = '1.0.0';

export const CORE_SYSTEM_PROMPT = [
  'Você é a assistente operacional da Inexci para WhatsApp.',
  'Seu papel é orquestrar ferramentas e responder de forma curta, clara e segura.',
  'Nunca invente dados clínicos, IDs, códigos TUSS/CID ou resultados de tools.',
  'Use tools para consultar, validar ou executar ações; quando faltar dado obrigatório, peça apenas o próximo dado faltante.',
  'Confirmações explícitas são obrigatórias antes de mutações sensíveis.',
  'A resposta final deve ser em português brasileiro, sem markdown e adequada ao WhatsApp.',
].join(' ');

export function buildWorkflowModule(
  runtimeState: RuntimeState,
  planner: PlannerOutput,
): string | null {
  const lines: string[] = [];

  if (runtimeState.activeWorkflow !== 'idle') {
    lines.push(`WORKFLOW_ATIVO: ${runtimeState.activeWorkflow}`);
  }
  if (runtimeState.activeDraft) {
    lines.push(`DRAFT_ATIVO: ${runtimeState.activeDraft}`);
  }
  if (runtimeState.currentStep) {
    lines.push(
      `ETAPA_ATUAL: ${runtimeState.currentStep.label} (${runtimeState.currentStep.status})`,
    );
  }
  if (runtimeState.missingFields.length) {
    lines.push(`CAMPOS_FALTANTES: ${runtimeState.missingFields.join(', ')}`);
  }
  if (planner.nextBestAction) {
    lines.push(`PROXIMA_ACAO: ${planner.nextBestAction}`);
  }

  return lines.length ? lines.join('\n') : null;
}

export function buildToolPolicyModule(
  runtimeState: RuntimeState,
  planner: PlannerOutput,
): string {
  const lines = [
    'POLITICA_DE_TOOLS:',
    '- Antes de mutacoes complexas, abra ou retome o draft correto.',
    '- Prefira a tool candidata do planner quando houver uma unica opcao plausivel.',
    '- Se houver pendingConfirmation, retome a confirmacao pendente antes de iniciar outro fluxo.',
  ];

  if (planner.toolCandidate) {
    lines.push(`- TOOL_CANDIDATA_ATUAL: ${planner.toolCandidate}`);
  }
  if (runtimeState.pendingConfirmation?.tool) {
    lines.push(
      `- CONFIRMACAO_PENDENTE: ${runtimeState.pendingConfirmation.tool}`,
    );
  }

  return lines.join('\n');
}

export function buildResponseStyleModule(): string {
  return [
    'ESTILO_DE_RESPOSTA:',
    '- Responda de forma objetiva e acolhedora.',
    '- Nao exponha payload tecnico interno.',
    '- Quando fizer sentido, ofereca no maximo 3 proximos passos acionaveis.',
  ].join('\n');
}
