import { PiiVaultService } from '../services/pii-vault.service';
import { PROMPT_VERSION, SYSTEM_PROMPT } from './system-prompt';

describe('SYSTEM_PROMPT', () => {
  it('expõe versão e conteúdo não vazios', () => {
    expect(typeof PROMPT_VERSION).toBe('string');
    expect(PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(SYSTEM_PROMPT.trim().length).toBeGreaterThan(100);
  });

  // Regressão: o prompt já chegou a conter literais de PII estruturada
  // (ex.: "123.456.789-00", "11 99999-9999", "exemplo@dominio.com") usados
  // como exemplos negativos. O `assertNoResidualPii` rodando antes da
  // chamada à OpenAI detectava esses literais e bloqueava 100% das
  // mensagens com erro `PII_RESIDUAL`. O prompt deve usar APENAS
  // placeholders abstratos — sem dígitos e sem `@<dominio>` real.
  it('não contém literais de CPF/telefone/e-mail que disparem o filtro defensivo', () => {
    const vault = new PiiVaultService();
    const findings = vault.detectResidualPii(SYSTEM_PROMPT);
    expect(findings).toEqual([]);
  });

  // Em 1.5.1 o usuário pediu para REMOVER emojis de todas as respostas.
  // O prompt deve continuar gentil/profissional, mas instruir explicitamente
  // que NUNCA é para usar emojis. Esse assert evita regredir para a versão
  // anterior que tolerava 1-2 emojis.
  it('orienta a IA a usar tom gentil e proibe completamente emojis', () => {
    expect(SYSTEM_PROMPT).toMatch(/gentil/i);
    expect(SYSTEM_PROMPT).toMatch(/N[ÃA]O use emojis/i);
  });

  it('orienta a IA a oferecer próximos passos como opções numeradas', () => {
    expect(SYSTEM_PROMPT).toMatch(/pr[óo]ximos passos/i);
    expect(SYSTEM_PROMPT).toMatch(/op[çc][õo]es numeradas/i);
    expect(SYSTEM_PROMPT).toMatch(/1 - /);
  });

  // Em 1.6.0 o usuário relatou que a IA inventava os requisitos para criar
  // uma SC (incluía TUSS/OPME/laudo na criação, quando esses são exigências
  // só do envio). O prompt agora obriga a IA a chamar a tool
  // get_workflow_requirements em vez de listar requisitos de cabeça.
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

  // Regressão da v1.7.1 — print de 2026-05-11:
  //   "1 - SC-565044 — Patrícia / 2 - Hospital: Sírio-Libanês / 3 - Convênio: ..."
  // A IA tinha pedido "minhas SC" e veio: lista renumerada, ordem de status
  // fora do workflow (Pendente por último) e detalhes de uma SC enxertados
  // dentro da listagem geral. Os 3 reforços abaixo evitam regressão.
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

  // Regressão v1.7.2 — print de 2026-05-11:
  // A IA ofereceu "1 - Ver detalhes / 2 - Ver pendências / 3 - Criar nova SC",
  // o usuário respondeu apenas "3" e a IA disse "não ficou claro qual ação".
  // O prompt agora obriga a interpretar dígitos isolados como escolha da
  // opção correspondente do turno anterior.
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

  // ============================================================
  // v2.0 — Drafts de operação
  // ============================================================

  it('é versão 2.x', () => {
    expect(PROMPT_VERSION.startsWith('2.')).toBe(true);
  });

  it('explica que toda criação/edição complexa passa por plan_actions + draft', () => {
    expect(SYSTEM_PROMPT).toMatch(/DRAFTS DE OPERA[ÇC][ÃA]O/);
    expect(SYSTEM_PROMPT).toMatch(/plan_actions/);
    expect(SYSTEM_PROMPT).toMatch(/RASCUNHO ESTRUTURADO/);
  });

  it('lista as tools de set_* e o ciclo preview/commit', () => {
    expect(SYSTEM_PROMPT).toMatch(/sc_draft_set_/);
    expect(SYSTEM_PROMPT).toMatch(/_draft_preview/);
    expect(SYSTEM_PROMPT).toMatch(/_draft_commit/);
    expect(SYSTEM_PROMPT).toMatch(/confirm=true/);
  });

  it('explica sub-drafts (cadastros aninhados dentro de criação de SC)', () => {
    expect(SYSTEM_PROMPT).toMatch(/SUB-DRAFT/);
    expect(SYSTEM_PROMPT).toMatch(/RETOMA o draft pai/);
  });

  it('aposenta create_surgery_request_from_whatsapp', () => {
    expect(SYSTEM_PROMPT).toMatch(
      /create_surgery_request_from_whatsapp.*deprecada/i,
    );
  });

  it('deixa claro que nomes de paciente/hospital/convênio ficam EM CLARO (não tokenizados)', () => {
    expect(SYSTEM_PROMPT).toMatch(/N[ÃA]O s[ãa]o tokenizados/i);
  });
});
