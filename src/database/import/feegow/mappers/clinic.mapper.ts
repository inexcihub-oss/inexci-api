import { LinhaCsv } from '../../core/csv';
import {
  EMAIL_MAX,
  emailLongoDemais,
  normalizarCep,
  normalizarData,
  normalizarEmail,
  normalizarTexto,
  normalizarUf,
  soDigitos,
  telefonesDistintos,
} from '../../core/normalizers';
import { ContextoImportacao } from '../context';
import { ExportFeegow } from '../export';
import {
  BusinessHours,
  MAX_BLOCKS_PER_DAY,
  TimeBlock,
  WEEKDAY_KEYS,
} from 'src/shared/business-hours/business-hours.types';

export const LEDGER_CLINICA = 'clinic';

export interface NovaClinica {
  id: string;
  ownerId: string;
  name: string;
  cnpj: string | null;
  email: string | null;
  phone: string | null;
  zipCode: string | null;
  address: string | null;
  addressNumber: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  businessHours: BusinessHours;
  active: boolean;
}

/**
 * A única unidade do Feegow vira a clínica (local de atendimento). O horário
 * de funcionamento é a união das grades vigentes de todos os profissionais —
 * a grade individual de cada um é outra trilha (MIG-05).
 */
export function planejarClinica(
  exp: ExportFeegow,
  ctx: ContextoImportacao,
): NovaClinica | null {
  const unidade = exp.tabela('unidades')[0];
  if (!unidade) return null;
  const idOrigem = unidade.id ?? '0';
  if (ctx.ledger.resolver(LEDGER_CLINICA, idOrigem)) {
    ctx.relatorio.pular('clínica');
    return null;
  }

  const nome =
    normalizarTexto(unidade.nome_fantasia, 150) ??
    normalizarTexto(unidade.nome_unidade, 150);
  if (!nome) {
    ctx.relatorio.rejeitar('clínica', idOrigem, 'sem nome');
    return null;
  }

  const id = ctx.novoId();
  ctx.ledger.registrar(LEDGER_CLINICA, idOrigem, id);
  ctx.relatorio.aceitar('clínica');
  const cnpj = soDigitos(unidade.cnpj);
  return {
    id,
    ownerId: ctx.ownerId,
    name: nome,
    cnpj: cnpj.length === 14 ? cnpj : null,
    email: emailDaClinica(unidade, idOrigem, ctx),
    phone:
      telefonesDistintos([unidade.tel1, unidade.cel1, unidade.tel2])[0] ?? null,
    zipCode: normalizarCep(unidade.cep),
    address: normalizarTexto(unidade.endereco, 200),
    addressNumber: normalizarTexto(unidade.numero, 20),
    neighborhood: normalizarTexto(unidade.bairro, 100),
    city: normalizarTexto(unidade.cidade, 100),
    state: normalizarUf(unidade.estado),
    businessHours: horarioDaClinica(exp.tabela('grade_fixa'), ctx.hoje),
    active: true,
  };
}

/** 1º e-mail da unidade que cabe em `clinics.email`; o longo demais vira aviso. */
function emailDaClinica(
  unidade: LinhaCsv,
  idOrigem: string,
  ctx: ContextoImportacao,
): string | null {
  for (const bruto of [unidade.email1, unidade.email2]) {
    if (emailLongoDemais(bruto, EMAIL_MAX.clinica))
      ctx.relatorio.avisar(
        'clínica',
        idOrigem,
        `e-mail com mais de ${EMAIL_MAX.clinica} caracteres descartado`,
      );
  }
  return (
    normalizarEmail(unidade.email1, EMAIL_MAX.clinica) ??
    normalizarEmail(unidade.email2, EMAIL_MAX.clinica)
  );
}

const paraMinutos = (h: string) => {
  const [hh, mm] = h.split(':').map(Number);
  return hh * 60 + mm;
};
const paraHora = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * União das grades semanais vigentes (`fim_vigencia` vazia ou >= hoje), por
 * dia. A data passa pelo `normalizarData`, como em `planejarGrades`: o
 * Feegow grava `0000-00-00` como "sem fim" e às vezes DD/MM/AAAA — comparar
 * o texto cru tratava essas grades como vencidas. Feegow: `dia_semana` 1 = domingo … 7 = sábado. Blocos que se tocam ou
 * se sobrepõem são fundidos; o máximo por dia é o da INEXCI.
 */
export function horarioDaClinica(
  grade: LinhaCsv[],
  hoje: string,
): BusinessHours {
  const porDia = new Map<number, [number, number][]>();
  for (const g of grade) {
    const dia = Number(g.dia_semana) - 1;
    if (!(dia >= 0 && dia <= 6) || !g.hora_de || !g.hora_ate) continue;
    const fimVigencia = normalizarData(g.fim_vigencia);
    if (fimVigencia && fimVigencia < hoje) continue;
    const inicio = paraMinutos(g.hora_de);
    const fim = paraMinutos(g.hora_ate);
    if (!(fim > inicio)) continue;
    porDia.set(dia, [...(porDia.get(dia) ?? []), [inicio, fim]]);
  }

  const horario = Object.fromEntries(
    WEEKDAY_KEYS.map((k) => [k, [] as TimeBlock[]]),
  ) as BusinessHours;
  for (const [dia, blocos] of porDia) {
    const fundidos: [number, number][] = [];
    for (const [ini, fim] of blocos.sort((a, b) => a[0] - b[0])) {
      const ultimo = fundidos[fundidos.length - 1];
      if (ultimo && ini <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], fim);
      else fundidos.push([ini, fim]);
    }
    horario[WEEKDAY_KEYS[dia]] = fundidos
      .slice(0, MAX_BLOCKS_PER_DAY)
      .map(([ini, fim]) => ({ start: paraHora(ini), end: paraHora(fim) }));
  }
  return horario;
}
