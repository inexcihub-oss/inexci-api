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
 * CPF só com dígitos e válido. Com 9 ou 10 dígitos, tenta os zeros à esquerda
 * que a planilha de origem comeu (CPF lido como número) — e só aceita se o
 * resultado passar no dígito verificador.
 */
export function normalizarCpf(valor: string | null | undefined): string | null {
  const d = soDigitos(valor);
  if (d.length < 9 || d.length > 11) return null;
  const completo = d.padStart(11, '0');
  return cpfValido(completo) ? completo : null;
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

/**
 * Data + hora locais de `America/Sao_Paulo` → instante UTC. O Brasil não tem
 * horário de verão desde 2019 e os dados migrados são posteriores a isso na
 * prática; para datas anteriores a 2019 a diferença máxima é de 1 h, aceitável
 * para histórico. Offset fixo de -03:00.
 */
export function dataHoraSaoPaulo(
  data: string | null | undefined,
  hora?: string | null,
): Date | null {
  const d = normalizarData(data);
  if (!d) return null;
  const h = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec((hora ?? '').trim());
  const hhmmss = h ? `${h[1]}:${h[2]}:${h[3] ?? '00'}` : '00:00:00';
  const instante = new Date(`${d}T${hhmmss}-03:00`);
  return Number.isNaN(instante.getTime()) ? null : instante;
}

/** `YYYY-MM-DD HH:MM:SS` (como `sys_date`) → instante, em São Paulo. */
export function dataHoraCompleta(
  valor: string | null | undefined,
): Date | null {
  const v = (valor ?? '').trim();
  const m = /^(\S+)[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(v);
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
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&([a-zA-Z]+);/g, (inteira, nome: string) => {
      if (ENTIDADES_HTML[nome]) return ENTIDADES_HTML[nome];
      const m = /^([a-zA-Z])(acute|grave|circ|tilde|uml|cedil)$/.exec(nome);
      return m ? (m[1] + acentos[m[2]]).normalize('NFC') : inteira;
    });
}
