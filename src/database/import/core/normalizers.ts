/**
 * Normalizadores dos campos vindos de sistemas de origem. Todos devolvem
 * `null` quando o valor não é aproveitável — nunca string vazia nem um valor
 * "consertado" por chute.
 */

const UFS = new Set([
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
]);

export const soDigitos = (v: string | null | undefined): string =>
  (v ?? '').replace(/\D/g, '');

/** Dígitos verificadores do CPF. */
export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (base: string, pesoInicial: number) => {
    const soma = [...base].reduce(
      (acc, d, i) => acc + Number(d) * (pesoInicial - i),
      0,
    );
    return ((soma * 10) % 11) % 10;
  };
  return (
    dv(cpf.slice(0, 9), 10) === Number(cpf[9]) &&
    dv(cpf.slice(0, 10), 11) === Number(cpf[10])
  );
}

/**
 * CPF só com dígitos e válido (11 dígitos, com ou sem máscara).
 *
 * Com 10 dígitos, só recupera o zero à esquerda quando o valor é um número
 * cru (só dígitos, sem máscara) — a cara de CPF que a planilha de origem leu
 * como número. Completar qualquer valor curto deixa passar ~1 em 100 RGs ou
 * números aleatórios como o CPF de outra pessoa (o dígito verificador por
 * acaso bate); 9 dígitos (dois zeros comidos) e valor mascarado curto nunca
 * são completados.
 */
export function normalizarCpf(valor: string | null | undefined): string | null {
  const bruto = (valor ?? '').trim();
  const d = soDigitos(bruto);
  if (d.length === 11) return cpfValido(d) ? d : null;
  if (d.length === 10 && /^\d{10}$/.test(bruto)) {
    const completo = `0${d}`;
    return cpfValido(completo) ? completo : null;
  }
  return null;
}

/**
 * Telefone brasileiro só com dígitos: 10 (fixo) ou 11 (celular) com DDD.
 * Com o 55 do país na frente, remove. Qualquer outra coisa (e-mail digitado no
 * campo, número sem DDD) vira `null`.
 */
export function normalizarTelefone(
  valor: string | null | undefined,
): string | null {
  if (!valor || /[a-z@]/i.test(valor)) return null;
  let d = soDigitos(valor);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55'))
    d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : null;
}

/** Primeiros telefones válidos e distintos, na ordem de preferência. */
export function telefonesDistintos(
  valores: (string | null | undefined)[],
): string[] {
  const vistos: string[] = [];
  for (const v of valores) {
    const t = normalizarTelefone(v);
    if (t && !vistos.includes(t)) vistos.push(t);
  }
  return vistos;
}

/** CEP no formato `99999-999`; 7 dígitos ganham o zero à esquerda. */
export function normalizarCep(valor: string | null | undefined): string | null {
  const d = soDigitos(valor);
  if (d.length < 7 || d.length > 8) return null;
  const c = d.padStart(8, '0');
  return `${c.slice(0, 5)}-${c.slice(5)}`;
}

export function normalizarUf(valor: string | null | undefined): string | null {
  const uf = (valor ?? '').trim().toUpperCase();
  return UFS.has(uf) ? uf : null;
}

/** Feegow: `1` masculino, `2` feminino; `0`, `3` (indefinido) e vazio → null. */
export function normalizarSexo(
  valor: string | null | undefined,
): 'M' | 'F' | null {
  if (valor === '1') return 'M';
  if (valor === '2') return 'F';
  return null;
}

export function normalizarEmail(
  valor: string | null | undefined,
): string | null {
  const e = (valor ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** Texto livre: colapsa espaços e corta no tamanho da coluna. */
export function normalizarTexto(
  valor: string | null | undefined,
  max: number,
): string | null {
  const t = (valor ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

/**
 * Data `YYYY-MM-DD` (ou `DD/MM/YYYY`) → `YYYY-MM-DD`. `0000-00-00`, datas
 * impossíveis e vazias → null.
 */
export function normalizarData(
  valor: string | null | undefined,
): string | null {
  const v = (valor ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) {
    const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(v);
    if (br) m = [br[0], br[3], br[2], br[1]] as unknown as RegExpExecArray;
  }
  if (!m) return null;
  const [, a, mes, d] = m;
  const data = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(d)));
  if (
    Number(a) < 1900 ||
    data.getUTCFullYear() !== Number(a) ||
    data.getUTCMonth() !== Number(mes) - 1 ||
    data.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return `${a}-${mes}-${d}`;
}

const FUSO_DA_CLINICA = 'America/Sao_Paulo';

const formatadorSaoPaulo = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_DA_CLINICA,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Diferença (ms) entre o relógio de São Paulo e o UTC no instante dado. */
function offsetSaoPaulo(instante: number): number {
  const p: Record<string, number> = {};
  for (const parte of formatadorSaoPaulo.formatToParts(new Date(instante))) {
    if (parte.type !== 'literal') p[parte.type] = Number(parte.value);
  }
  const relogio = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return relogio - Math.floor(instante / 1000) * 1000;
}

/**
 * Data + hora locais de `America/Sao_Paulo` → instante UTC, com as regras
 * reais do fuso (tz database via `Intl`): até 2019 havia horário de verão
 * (-02:00), e um offset fixo de -03:00 erraria em 1 h as consultas de verão.
 *
 * Sem hora (ou hora vazia) → meia-noite local. Hora presente mas ilegível
 * (`9h`, `25:00`) → `null`, para o chamador rejeitar/avisar em vez de gravar
 * meia-noite calado. Aceita hora com 1 ou 2 dígitos (`9:00`). Horário que não
 * existe (o relógio pulava de 00:00 para 01:00 no início do horário de verão)
 * cai no primeiro instante válido depois.
 */
export function dataHoraSaoPaulo(
  data: string | null | undefined,
  hora?: string | null,
): Date | null {
  const d = normalizarData(data);
  if (!d) return null;
  const textoHora = (hora ?? '').trim();
  let hh = 0;
  let mm = 0;
  let ss = 0;
  if (textoHora) {
    const h = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(textoHora);
    if (!h) return null;
    [hh, mm, ss] = [Number(h[1]), Number(h[2]), Number(h[3] ?? 0)];
    if (hh > 23 || mm > 59 || ss > 59) return null;
  }
  const [a, mes, dia] = d.split('-').map(Number);
  const relogio = Date.UTC(a, mes - 1, dia, hh, mm, ss);
  // Duas passadas: o offset depende do instante, que depende do offset.
  const palpite = relogio - offsetSaoPaulo(relogio);
  const offset = offsetSaoPaulo(palpite);
  const instante = relogio - offset;
  const ajustado =
    offsetSaoPaulo(instante) === offset
      ? instante
      : relogio - offsetSaoPaulo(instante);
  const resultado = new Date(ajustado);
  return Number.isNaN(resultado.getTime()) ? null : resultado;
}

/**
 * `YYYY-MM-DD HH:MM:SS` (como `sys_date`) → instante, em São Paulo. Hora
 * presente mas ilegível → `null` (ver `dataHoraSaoPaulo`).
 */
export function dataHoraCompleta(
  valor: string | null | undefined,
): Date | null {
  const v = (valor ?? '').trim();
  const m = /^(\S+)[ T](.+)$/.exec(v);
  return m ? dataHoraSaoPaulo(m[1], m[2]) : dataHoraSaoPaulo(v);
}

const ENTIDADES_HTML: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ordm: 'º',
  ordf: 'ª',
};

/**
 * Entidades HTML (`&ccedil;`, `&atilde;`, `&#231;`…) → caractere. O Feegow
 * gravou parte dos textos de log já escapados. Letras acentuadas são
 * montadas pela regra do nome (`&Xacute;` = X + acento agudo); entidade
 * desconhecida fica como está.
 */
export function decodificarEntidadesHtml(texto: string): string {
  const acentos: Record<string, string> = {
    acute: '́',
    grave: '̀',
    circ: '̂',
    tilde: '̃',
    uml: '̈',
    cedil: '̧',
  };
  return texto
    .replace(/&#(\d+);/g, (inteira, n: string) =>
      caractereDoCodigo(Number(n), inteira),
    )
    .replace(/&#x([0-9a-f]+);/gi, (inteira, n: string) =>
      caractereDoCodigo(parseInt(n, 16), inteira),
    )
    .replace(/&([a-zA-Z]+);/g, (inteira, nome: string) => {
      if (ENTIDADES_HTML[nome]) return ENTIDADES_HTML[nome];
      const m = /^([a-zA-Z])(acute|grave|circ|tilde|uml|cedil)$/.exec(nome);
      return m ? (m[1] + acentos[m[2]]).normalize('NFC') : inteira;
    });
}

/**
 * Caractere do código numérico de uma entidade. Fora do Unicode (> 0x10FFFF,
 * que faria o `String.fromCodePoint` lançar), NUL ou metade de par substituto
 * → a entidade fica como está.
 */
function caractereDoCodigo(codigo: number, original: string): string {
  if (
    !Number.isInteger(codigo) ||
    codigo <= 0 ||
    codigo > 0x10ffff ||
    (codigo >= 0xd800 && codigo <= 0xdfff)
  ) {
    return original;
  }
  return String.fromCodePoint(codigo);
}

const ENTIDADES_EM_MAIUSCULAS: Record<string, string> = {
  PERIOD: '.',
  APOS: "'",
  QUOT: '"',
  AMP: '&',
  COMMA: ',',
  HYPHEN: '-',
};

/**
 * Nome que o export do Feegow cortou numa entidade HTML em maiúsculas sem o
 * `;` (`JOS&EACUTE`, `GON&CCEDIL`): devolve o caractere (`JOSÉ`, `GONÇ`) e se
 * houve corte. O resto do nome não veio no export — só dá para avisar.
 */
export function repararNomeCortado(nome: string): {
  nome: string;
  cortado: boolean;
} {
  let cortado = false;
  const reparado = nome.replace(/&([A-Z]{2,8});?/g, (inteiro, ent: string) => {
    cortado = true;
    if (ENTIDADES_EM_MAIUSCULAS[ent]) return ENTIDADES_EM_MAIUSCULAS[ent];
    const letra = decodificarEntidadesHtml(
      `&${ent[0]}${ent.slice(1).toLowerCase()};`,
    );
    return letra.startsWith('&') ? inteiro : letra;
  });
  return { nome: reparado.trim(), cortado };
}
