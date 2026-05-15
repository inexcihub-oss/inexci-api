/**
 * Módulo de prompt para o draft `create_sc` (Fase 2 do Blueprint v3).
 *
 * Carregado APENAS quando `OperationalState.active_workflow.name === 'create_sc'`.
 * Contém somente regras específicas do fluxo de criação de SC; o resto
 * do contexto (estado, hints) vem via OPERATIONAL_STATE.
 */
export const CREATE_SC_MODULE = `WORKFLOW ATIVO: create_sc.
- Para resolver "Maria Silva", "Hospital São Lucas" etc. em IDs, use as tools de lookup (query_patients, list_sc_creation_catalog) ANTES do draft_update.
- Quando NÃO encontrar uma entidade, abra sub-draft de cadastro (plan_actions com intent create_patient/create_hospital/create_health_plan/create_procedure).
- Hospital e convênio são opcionais; procedimento é obrigatório.
- Prioridade default = "LOW" se o usuário não disser nada (não pergunte).
- Médico é auto-preenchido quando o próprio usuário é médico ou só há 1 médico acessível.
- TUSS, OPME e laudo NÃO são exigidos para CRIAR — só para ENVIAR.
- Quando vier de documento (PDF/imagem), o draft já chega pré-preenchido. Cheque OPERATIONAL_STATE.active_workflow.fields_filled antes de perguntar.`;
