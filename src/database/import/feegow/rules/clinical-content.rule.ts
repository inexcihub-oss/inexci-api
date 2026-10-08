import { htmlSemTexto, sanitizarHtmlClinico } from '../../core/html';
import { decodificarEntidadesHtml } from '../../core/normalizers';
import { chaveDeNome } from '../context';
import { MODELOS_COM_CONDUTA_NO_TEXTO } from '../regras-do-cliente';

export type CampoFicha = 'anamnesis' | 'physicalExam' | 'diagnosis' | 'conduct';

export interface ConteudoFicha {
  anamnesis: string | null;
  physicalExam: string | null;
  diagnosis: string | null;
  conduct: string | null;
}

/** Um formulário preenchido do Feegow (linha de `_N.csv`). */
export interface FormularioFeegow {
  modeloId: string;
  nomeModelo: string;
  quando: Date;
  /** `conteudo_resumo`: blocos "Campo : valor" separados por linha em branco. */
  conteudo: string;
  /** `sys_active = 0` no Feegow, importado só com `--incluir-rascunhos`. */
  rascunho?: boolean;
}

/** Id usado para o resumo de IA (`pacientes_ai_summary`), que tem seções `<h3>`. */
export const MODELO_RESUMO_IA = '-ia';

/**
 * Título de seção (`<h3>` dos formulários de IA) ou rótulo de campo
 * ("Queixa Principal :") → campo da ficha. Chave sem acento, minúscula.
 */
const CAMPO_POR_TITULO: Record<string, CampoFicha> = {
  'queixa principal': 'anamnesis',
  'historia da doenca atual': 'anamnesis',
  'historico medico': 'anamnesis',
  'historico medico passado': 'anamnesis',
  'historico social': 'anamnesis',
  'medicacoes atuais': 'anamnesis',
  'medicamentos em uso': 'anamnesis',
  alergias: 'anamnesis',
  'observacoes extras': 'anamnesis',
  'exame fisico': 'physicalExam',
  avaliacao: 'diagnosis',
  'avaliacao e observacoes clinicas': 'diagnosis',
  'hipotese diagnostica': 'diagnosis',
  diagnostico: 'diagnosis',
  plano: 'conduct',
  prescricao: 'conduct',
  'exercicios e tarefas': 'conduct',
  consultas: 'conduct',
  'orientacoes e observacoes gerais': 'conduct',
  conduta: 'conduct',
};

/** Rótulos genéricos do editor de formulários do Feegow: não informam nada. */
const ROTULO_GENERICO = /^novo (texto|memo)$/i;

const ORDEM: CampoFicha[] = [
  'anamnesis',
  'physicalExam',
  'diagnosis',
  'conduct',
];

export interface BlocoFeegow {
  rotulo: string;
  valor: string;
}

/**
 * `conteudo_resumo` → blocos. O Feegow achata o formulário em
 * `Rótulo : valor`, um campo por parágrafo; formulário de caixa livre tem
 * rótulo vazio (` : <html>`).
 */
export function blocosFeegow(conteudo: string): BlocoFeegow[] {
  return conteudo
    .replace(/\r\n?/g, '\n')
    .split(/\n\n(?=[^:\n<>]{0,60} : )/)
    .map((trecho) => {
      const m = /^([^:\n<>]{0,60}) : ([\s\S]*)$/.exec(trecho);
      return m
        ? { rotulo: m[1].trim(), valor: m[2] }
        : { rotulo: '', valor: trecho };
    })
    .filter((b) => !htmlSemTexto(b.valor));
}

/** Corta o HTML nos `<h3>`: o que vem antes entra sem título. */
export function secoesPorTitulo(
  html: string,
): { titulo: string | null; html: string }[] {
  const partes = html.split(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  const secoes: { titulo: string | null; html: string }[] = [];
  if (!htmlSemTexto(partes[0])) secoes.push({ titulo: null, html: partes[0] });
  for (let i = 1; i < partes.length; i += 2) {
    const titulo = decodificarEntidadesHtml(partes[i].replace(/<[^>]*>/g, ''))
      .replace(/\s+/g, ' ')
      .trim();
    secoes.push({ titulo: titulo || null, html: partes[i + 1] ?? '' });
  }
  return secoes;
}

/** Texto para comparar conteúdos (ignora tags, rótulos, espaços e caixa). */
export function textoComparavel(conteudo: string): string {
  return chaveDeNome(
    decodificarEntidadesHtml(
      blocosFeegow(conteudo)
        .map((b) => b.valor)
        .join(' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' '),
    ),
  ).replace(/[^\p{L}\p{N}]+/gu, ' ');
}

const campoDoTitulo = (titulo: string | null): CampoFicha | null =>
  titulo ? (CAMPO_POR_TITULO[chaveDeNome(titulo)] ?? null) : null;

/**
 * Um formulário → pedaços de HTML por campo.
 *
 * - Formulário de IA (id negativo) e resumo de IA: cada seção `<h3>` vai para
 *   o campo do título, mantendo o título; título desconhecido → anamnese.
 * - Formulário com rótulos ("Queixa Principal :"): cada campo vai para o
 *   campo do rótulo, com o rótulo em negrito; rótulo desconhecido → caixa
 *   livre.
 * - Caixa livre (rótulo vazio): tudo para `caixaLivre`; nos modelos com
 *   conduta no meio do texto, o trecho a partir de "cdt:"/"conduta:" vai
 *   para a conduta.
 */
export function camposDoFormulario(
  f: FormularioFeegow,
  caixaLivre: CampoFicha,
): Partial<Record<CampoFicha, string[]>> {
  const campos: Partial<Record<CampoFicha, string[]>> = {};
  const add = (campo: CampoFicha, html: string) => {
    if (htmlSemTexto(html)) return;
    (campos[campo] ??= []).push(html);
  };

  // Ids negativos são os formulários de IA do Feegow (seções em `<h3>`).
  const modoSecoes = f.modeloId.startsWith('-');
  for (const bloco of blocosFeegow(f.conteudo)) {
    if (modoSecoes) {
      for (const s of secoesPorTitulo(bloco.valor)) {
        const campo = campoDoTitulo(s.titulo) ?? 'anamnesis';
        add(
          campo,
          s.titulo ? `<h3>${escapar(s.titulo)}</h3>${s.html}` : s.html,
        );
      }
      continue;
    }

    const rotulo =
      bloco.rotulo &&
      !ROTULO_GENERICO.test(bloco.rotulo) &&
      chaveDeNome(bloco.rotulo) !== chaveDeNome(f.nomeModelo)
        ? bloco.rotulo
        : '';
    const campo = campoDoTitulo(rotulo) ?? caixaLivre;
    const titulo = rotulo ? `<p><strong>${escapar(rotulo)}</strong></p>` : '';

    if (!rotulo && MODELOS_COM_CONDUTA_NO_TEXTO.has(f.modeloId)) {
      const corte = /(?:^|<br\s*\/?>|\s)(cdt|conduta)\s*:/i.exec(bloco.valor);
      if (corte) {
        add(campo, bloco.valor.slice(0, corte.index));
        add('conduct', bloco.valor.slice(corte.index));
        continue;
      }
    }
    add(campo, titulo + bloco.valor);
  }
  return campos;
}

/** Texto vindo do Feegow que vira HTML (títulos, rótulos, nome do formulário). */
function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function quandoBR(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
    .format(d)
    .replace(',', '');
}

/**
 * Formulários de um atendimento (ou um formulário solto) → os quatro campos
 * da ficha, em HTML sanitizado. Com 2+ formulários (ou rascunho), cada bloco
 * ganha um `<h4>` com o nome do formulário e a data, em ordem cronológica.
 */
export function conteudoDaFicha(
  formularios: FormularioFeegow[],
  caixaLivre: CampoFicha,
): ConteudoFicha {
  const ordenados = [...formularios].sort(
    (a, b) => a.quando.getTime() - b.quando.getTime(),
  );
  const porFormulario = ordenados
    .map((f) => ({ f, campos: camposDoFormulario(f, caixaLivre) }))
    .filter(({ campos }) => Object.keys(campos).length > 0);
  const comCabecalho =
    porFormulario.length > 1 || porFormulario.some(({ f }) => f.rascunho);

  const resultado: ConteudoFicha = {
    anamnesis: null,
    physicalExam: null,
    diagnosis: null,
    conduct: null,
  };
  for (const campo of ORDEM) {
    const pedacos = porFormulario.flatMap(({ f, campos }) => {
      const html = campos[campo];
      if (!html) return [];
      const cabecalho = comCabecalho
        ? `<h4>${escapar(f.nomeModelo)} — ${quandoBR(f.quando)}${f.rascunho ? ' (rascunho no Feegow)' : ''}</h4>`
        : '';
      return [cabecalho + html.join('')];
    });
    const html = sanitizarHtmlClinico(pedacos.join(''));
    resultado[campo] = html && !htmlSemTexto(html) ? html : null;
  }
  return resultado;
}
