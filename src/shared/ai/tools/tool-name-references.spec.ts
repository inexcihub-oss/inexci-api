import * as fs from 'fs';
import * as path from 'path';
import { SYSTEM_PROMPT } from '../prompts/system-prompt';
import { PENDENCIES_CONFIG } from '../../../config/pendencies.config';
import { recommendActionForPendency } from './helpers/pendency-actions';
import { buildRegisteredTools } from './registered-tools.fixture-spec';
import { ANY_AUTHENTICATED } from './tool.interface';
import { Permission } from 'src/shared/permissions';

const TOOL_VERBS =
  /^(plan|draft|query|get|list|search|upload|set|add|advance|close|reschedule|confirm|update|manage|attach|create|send|mark|start|accept|invoice|contestation|scheduling|sc|patient|hospital|health|procedure|remove|delete)_/;

const NAO_SAO_TOOLS = new Set([
  'create_sc',
  'create_patient',
  'create_hospital',
  'create_health_plan',
  'create_procedure',
  'update_sc',
  'send_sc',
  'start_analysis',
  'accept_authorization',
  'mark_performed',
  'patient_name_or_id',
  'patient_name',
  'hospital_name',
  'health_plan_name',
  'health_plan',
  'health_plans',
  'patient_data',
  'hospital_data',
  'draft_type',
  'draft_types',
  'plan_steps',
  'invoice_protocol',
]);

function candidatos(texto: string): string[] {
  const tokens =
    texto.match(/(?<![a-z_])(?:\*_)?[a-z]+(?:_[a-z*]+)+\*?/g) ?? [];
  return tokens.filter(
    (t) =>
      (TOOL_VERBS.test(t.replace(/^\*_?/, '')) || t.startsWith('*_')) &&
      !NAO_SAO_TOOLS.has(t),
  );
}

function existe(token: string, registradas: Set<string>): boolean {
  if (!token.includes('*')) return registradas.has(token);
  const re = new RegExp('^' + token.split('*').join('[a-z_]+') + '$');
  return [...registradas].some((nome) => re.test(nome));
}

function textosDaDefinicao(valor: unknown): string[] {
  if (typeof valor === 'string') return [valor];
  if (Array.isArray(valor)) return valor.flatMap(textosDaDefinicao);
  if (valor && typeof valor === 'object') {
    return Object.entries(valor).flatMap(([chave, v]) =>
      chave === 'description' || typeof v === 'object'
        ? textosDaDefinicao(v)
        : [],
    );
  }
  return [];
}

function literaisDoFonte(arquivo: string): string[] {
  const fonte = fs.readFileSync(path.join(__dirname, arquivo), 'utf8');
  return fonte.match(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];
}

describe('referências a tools em prompts, hints e mapas', () => {
  const tools = buildRegisteredTools();
  const registradas = new Set(tools.map((t) => t.name));

  function ausentes(textos: string[]): string[] {
    return [
      ...new Set(
        textos.flatMap(candidatos).filter((t) => !existe(t, registradas)),
      ),
    ];
  }

  it('SYSTEM_PROMPT só cita tools registradas', () => {
    expect(ausentes([SYSTEM_PROMPT])).toEqual([]);
  });

  it('descrições das tools só citam tools registradas', () => {
    const textos = tools.flatMap((t) => textosDaDefinicao(t.definition));
    expect(ausentes(textos)).toEqual([]);
  });

  it('mapa pendência → ação só cita tools registradas (todas as variações)', () => {
    const chaves = [
      ...PENDENCIES_CONFIG.flatMap((c) => c.pendencies.map((p) => p.key)),
      'confirm_date',
      'confirm_receipt',
      'doc_qualquer',
      'chave_desconhecida',
    ];
    const variacoes = [
      [],
      [{ label: 'Indicar se há ou não OPME' }],
      [{ label: 'Assinatura do médico' }],
      [{ label: 'Seção de laudo' }],
      [{ label: 'CPF' }],
      [{ label: 'CPF' }, { label: 'Assinatura do médico' }],
    ];
    const acoes = chaves.flatMap((k) =>
      variacoes.map((v) => recommendActionForPendency(k, v).action),
    );
    expect(ausentes(acoes)).toEqual([]);
  });

  it('hints montados em código só citam tools registradas', () => {
    const textos = [
      '../services/orchestrator/next-step-advisor.service.ts',
      '../services/orchestrator/confirmation-manager.service.ts',
      './pendency.tools.ts',
      './action.tools.ts',
    ].flatMap(literaisDoFonte);
    expect(ausentes(textos)).toEqual([]);
  });

  it('detecta uma tool inexistente (sanidade do extrator)', () => {
    expect(ausentes(['chame `add_tuss_item` agora'])).toEqual([
      'add_tuss_item',
    ]);
  });
});

describe('toda tool registrada declara requiredPermission', () => {
  const validas = new Set<unknown>([
    ANY_AUTHENTICATED,
    ...Object.values(Permission),
  ]);

  it.each(buildRegisteredTools().map((t) => [t.name, t] as const))(
    '%s',
    (_nome, tool) => {
      const exigida = tool.requiredPermission;
      expect(exigida).toBeDefined();
      const lista = Array.isArray(exigida) ? exigida : [exigida];
      expect(lista.length).toBeGreaterThan(0);
      for (const p of lista) expect(validas.has(p)).toBe(true);
    },
  );

  it('upload_doctor_signature espelha a rota HTTP (ADMINISTRACAO | SOLICITACOES | ATENDIMENTO)', () => {
    const tool = buildRegisteredTools().find(
      (t) => t.name === 'upload_doctor_signature',
    )!;
    expect([...(tool.requiredPermission as Permission[])].sort()).toEqual(
      [
        Permission.ADMINISTRACAO,
        Permission.SOLICITACOES,
        Permission.ATENDIMENTO,
      ].sort(),
    );
  });
});
