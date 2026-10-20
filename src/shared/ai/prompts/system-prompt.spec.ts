import { PiiVaultService } from '../services/pii-vault.service';
import { PROMPT_VERSION, SYSTEM_PROMPT } from './system-prompt';

describe('SYSTEM_PROMPT', () => {
  it('expõe versão e conteúdo não vazios', () => {
    expect(typeof PROMPT_VERSION).toBe('string');
    expect(PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(SYSTEM_PROMPT.trim().length).toBeGreaterThan(100);
  });

  it('não contém literais de CPF/telefone/e-mail que disparem o filtro defensivo', () => {
    const vault = new PiiVaultService();
    const findings = vault.detectResidualPii(SYSTEM_PROMPT);
    expect(findings).toEqual([]);
  });

  it('orienta a IA a usar tom gentil e proibe completamente emojis', () => {
    expect(SYSTEM_PROMPT).toMatch(/gentil/i);
    expect(SYSTEM_PROMPT).toMatch(/N[ÃA]O use emojis/i);
  });

  it('orienta a IA a oferecer próximos passos como opções numeradas', () => {
    expect(SYSTEM_PROMPT).toMatch(/pr[óo]ximos passos/i);
    expect(SYSTEM_PROMPT).toMatch(/op[çc][õo]es numeradas/i);
    expect(SYSTEM_PROMPT).toMatch(/1 - /);
  });

  it('exige que a IA chame get_workflow_requirements quando perguntarem requisitos', () => {
    expect(SYSTEM_PROMPT).toMatch(/get_workflow_requirements/);
    expect(SYSTEM_PROMPT).toMatch(/CRIAR\s*≠\s*ENVIAR/);
  });

  it('deixa explícito que TUSS/OPME/laudo NÃO são requisito de criação', () => {
    expect(SYSTEM_PROMPT).toMatch(
      /TUSS.*OPME.*LAUDO.*N[ÃA]O.*exigidos.*criar/i,
    );
  });

  it('explica que OPME pode ser dispensado marcando que não há OPME na SC', () => {
    expect(SYSTEM_PROMPT).toMatch(/n[ãa]o\s+h[áa]\s+OPME/i);
    expect(SYSTEM_PROMPT).toMatch(/set_has_opme/);
  });

  it('limita "Próximos passos" a NO MÁXIMO 3 opções', () => {
    expect(SYSTEM_PROMPT).toMatch(/NO M[ÁA]XIMO 3 pr[óo]ximos passos/i);
    expect(SYSTEM_PROMPT).toMatch(/NUNCA passe de 3 op[çc][õo]es/i);
  });

  it('tem seção "FIDELIDADE AO PEDIDO" pedindo para não enxertar detalhes em listagens', () => {
    expect(SYSTEM_PROMPT).toMatch(/FIDELIDADE AO PEDIDO/);
    expect(SYSTEM_PROMPT).toMatch(
      /N[ÃA]O inclua hospital\/conv[êe]nio\/prioridade\/data\/pend[êe]ncias de uma SC espec[íi]fica dentro dessa resposta/i,
    );
  });

  it('exige preservação da ordem do output de tools (Pendente primeiro)', () => {
    expect(SYSTEM_PROMPT).toMatch(/PRESERVA[ÇC][ÃA]O DO OUTPUT DAS TOOLS/);
    expect(SYSTEM_PROMPT).toMatch(
      /Pendente[\s\S]*?Enviada[\s\S]*?Em An[áa]lise[\s\S]*?Em Agendamento/i,
    );
    expect(SYSTEM_PROMPT).toMatch(/Pendente é SEMPRE o primeiro grupo/i);
  });

  it('proíbe explicitamente prefixar SC com "1 -" / "2 -" / bullet', () => {
    expect(SYSTEM_PROMPT).toMatch(
      /Errado:\s*"1 - SC-565044 — Maria"\.\s*Certo:\s*"SC-565044 — Maria"/,
    );
  });

  it('tem seção "INTERPRETAÇÃO DE RESPOSTAS NUMÉRICAS DO USUÁRIO"', () => {
    expect(SYSTEM_PROMPT).toMatch(
      /INTERPRETA[ÇC][ÃA]O DE RESPOSTAS NUM[ÉE]RICAS DO USU[ÁA]RIO/,
    );
  });

  it('explica que dígito isolado após opções numeradas significa escolha daquela opção', () => {
    expect(SYSTEM_PROMPT).toMatch(/apenas com um d[íi]gito/i);
    expect(SYSTEM_PROMPT).toMatch(
      /Execute imediatamente a a[çc][ãa]o correspondente/i,
    );
  });

  it('proíbe responder "não ficou claro" quando o usuário mandou número de opção oferecida', () => {
    expect(SYSTEM_PROMPT).toMatch(
      /Jamais responda algo como "n[ãa]o ficou claro qual a[çc][ãa]o"/i,
    );
  });

  it('explica que numeração serve EXCLUSIVAMENTE para escolha por dígito', () => {
    expect(SYSTEM_PROMPT).toMatch(
      /POR UM [ÚU]NICO MOTIVO: permitir que o usu[áa]rio responda com o d[íi]gito/i,
    );
  });

  it('é versão 2.x', () => {
    expect(PROMPT_VERSION.startsWith('2.')).toBe(true);
  });

  it('explica que toda criação/edição complexa passa por plan_actions + draft', () => {
    expect(SYSTEM_PROMPT).toMatch(/DRAFTS DE OPERA[ÇC][ÃA]O/);
    expect(SYSTEM_PROMPT).toMatch(/plan_actions/);
    expect(SYSTEM_PROMPT).toMatch(/RASCUNHO ESTRUTURADO/);
  });

  it('lista a tool global draft_update e o ciclo preview/commit', () => {
    expect(SYSTEM_PROMPT).toMatch(/draft_update/);
    expect(SYSTEM_PROMPT).toMatch(/_draft_preview/);
    expect(SYSTEM_PROMPT).toMatch(/_draft_commit/);
    expect(SYSTEM_PROMPT).toMatch(/confirm=true/);
  });

  it('não menciona mais setters per-type *_draft_set_* como tool names', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/sc_draft_set_/);
    expect(SYSTEM_PROMPT).not.toMatch(/patient_draft_set_/);
    expect(SYSTEM_PROMPT).not.toMatch(/hospital_draft_set_/);
    expect(SYSTEM_PROMPT).not.toMatch(/health_plan_draft_set_/);
    expect(SYSTEM_PROMPT).not.toMatch(/procedure_draft_set_/);
    expect(SYSTEM_PROMPT).not.toMatch(/invoice_draft_set_/);
    expect(SYSTEM_PROMPT).not.toMatch(/contestation_draft_set_/);
    expect(SYSTEM_PROMPT).not.toMatch(/scheduling_draft_set_/);
    expect(SYSTEM_PROMPT).not.toMatch(/update_sc_draft_set_/);
    expect(SYSTEM_PROMPT).not.toMatch(/send_sc_draft_set_/);
    expect(SYSTEM_PROMPT).not.toMatch(/start_analysis_draft_set_/);
    expect(SYSTEM_PROMPT).not.toMatch(/accept_authorization_draft_set_/);
    expect(SYSTEM_PROMPT).not.toMatch(/mark_performed_draft_set_/);
  });

  it('não menciona mais Modo A/Modo B do draft (terminologia obsoleta)', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/Modo A/);
    expect(SYSTEM_PROMPT).not.toMatch(/Modo B/);
  });

  it('explica sub-drafts (cadastros aninhados dentro de criação de SC)', () => {
    expect(SYSTEM_PROMPT).toMatch(/SUB-DRAFT/);
    expect(SYSTEM_PROMPT).toMatch(/RETOMA o draft pai/);
  });

  it('não menciona mais create_surgery_request_from_whatsapp (tool legacy removida)', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/create_surgery_request_from_whatsapp/);
  });

  it('não menciona mais a tool legacy create_patient como tool name', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/`create_patient`/);
    expect(SYSTEM_PROMPT).not.toMatch(/create_patient\s*\(/);
  });

  it('não menciona mais create_hospital/create_health_plan/create_procedure como tool names', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/`create_hospital`/);
    expect(SYSTEM_PROMPT).not.toMatch(/create_hospital\s*\(/);
    expect(SYSTEM_PROMPT).not.toMatch(/`create_health_plan`/);
    expect(SYSTEM_PROMPT).not.toMatch(/create_health_plan\s*\(/);
    expect(SYSTEM_PROMPT).not.toMatch(/`create_procedure`/);
    expect(SYSTEM_PROMPT).not.toMatch(/create_procedure\s*\(/);
  });

  it('não menciona mais a tool legacy invoice_request como tool name', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/`invoice_request`/);
    expect(SYSTEM_PROMPT).not.toMatch(/invoice_request\s*\(/);
  });

  it('não menciona mais as tools legacy contest_authorization_full / contest_payment', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/`contest_authorization_full`/);
    expect(SYSTEM_PROMPT).not.toMatch(/contest_authorization_full\s*\(/);
    expect(SYSTEM_PROMPT).not.toMatch(/`contest_payment`/);
    expect(SYSTEM_PROMPT).not.toMatch(/contest_payment\s*\(/);
  });

  it('não menciona mais as tools legacy confirm_date / update_date_options como tool names', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/`confirm_date`/);
    expect(SYSTEM_PROMPT).not.toMatch(/confirm_date\s*\(/);
    expect(SYSTEM_PROMPT).not.toMatch(/`update_date_options`/);
    expect(SYSTEM_PROMPT).not.toMatch(/update_date_options\s*\(/);
  });

  it('não menciona mais a tool legacy mark_performed como tool name', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/`mark_performed`/);
    expect(SYSTEM_PROMPT).not.toMatch(/mark_performed\s*\(/);
  });

  it('não menciona mais as tools legacy de update como tool names', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/`update_request_clinical_data`/);
    expect(SYSTEM_PROMPT).not.toMatch(/update_request_clinical_data\s*\(/);
    expect(SYSTEM_PROMPT).not.toMatch(/`update_request_admin_data`/);
    expect(SYSTEM_PROMPT).not.toMatch(/update_request_admin_data\s*\(/);
    expect(SYSTEM_PROMPT).not.toMatch(/`update_patient_data`/);
    expect(SYSTEM_PROMPT).not.toMatch(/update_patient_data\s*\(/);
    expect(SYSTEM_PROMPT).not.toMatch(/`update_surgery_request_data`/);
    expect(SYSTEM_PROMPT).not.toMatch(/update_surgery_request_data\s*\(/);
  });

  it('deixa claro que nomes de paciente/hospital/convênio ficam EM CLARO (não tokenizados)', () => {
    expect(SYSTEM_PROMPT).toMatch(/N[ÃA]O s[ãa]o tokenizados/i);
  });

  it('é versão 2.1.x ou superior', () => {
    expect(PROMPT_VERSION).toMatch(/^2\.[1-9]/);
  });

  it('lista os 4 intents de transição de status com seus drafts', () => {
    expect(SYSTEM_PROMPT).toMatch(/send_sc/);
    expect(SYSTEM_PROMPT).toMatch(/start_analysis/);
    expect(SYSTEM_PROMPT).toMatch(/accept_authorization/);
    expect(SYSTEM_PROMPT).toMatch(/mark_performed/);
  });

  it('proíbe advance_surgery_request para transições ricas (1→2, 2→3, 3→4, 5→6)', () => {
    expect(SYSTEM_PROMPT).toMatch(
      /NUNCA chame `advance_surgery_request` para as transições "ricas"/,
    );
    expect(SYSTEM_PROMPT).toMatch(/1→2.*2→3.*3→4.*5→6/);
  });

  it('explica que send_sc valida checklist (hospital, TUSS, OPME, laudo)', () => {
    expect(SYSTEM_PROMPT).toMatch(/Enviar SC.*1→2/);
    expect(SYSTEM_PROMPT).toMatch(/checklist.*hospital.*TUSS.*OPME.*laudo/i);
  });

  it('explica que start_analysis precisa de nº da operadora + data de recebimento', () => {
    expect(SYSTEM_PROMPT).toMatch(/Iniciar an[áa]lise.*2→3/);
    expect(SYSTEM_PROMPT).toMatch(/requestNumber.*operadora/);
  });

  it('explica que accept_authorization precisa de 1-3 datas propostas', () => {
    expect(SYSTEM_PROMPT).toMatch(/Aceitar autoriza[çc][ãa]o.*3→4/);
    expect(SYSTEM_PROMPT).toMatch(/1 a 3 datas propostas/);
  });

  it('explica que mark_performed aceita docs pós-cirúrgicos opcionais via mark_performed_draft_check_docs', () => {
    expect(SYSTEM_PROMPT).toMatch(/Marcar como realizada.*5→6/);
    expect(SYSTEM_PROMPT).toMatch(/mark_performed_draft_check_docs/);
    expect(SYSTEM_PROMPT).toMatch(/opcionais.*faturamento/i);
  });

  it('é versão 2.2.0 ou superior', () => {
    const [major, minor] = PROMPT_VERSION.split('.').map(Number);
    expect(major).toBeGreaterThanOrEqual(2);
    if (major === 2) expect(minor).toBeGreaterThanOrEqual(2);
  });

  it('lista update_sc como intent válido de plan_actions', () => {
    expect(SYSTEM_PROMPT).toMatch(/"update_sc"/);
  });

  it('menciona que drafts cobrem criar/editar SC, paciente, hospital, convênio, procedimento', () => {
    expect(SYSTEM_PROMPT).toMatch(/plan_actions.*\*_draft_\*/);
  });
});
