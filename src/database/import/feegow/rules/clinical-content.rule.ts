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

export interface FormularioFeegow {
  modeloId: string;
  nomeModelo: string;
  quando: Date;
  conteudo: string;
  rascunho?: boolean;
}

export const MODELO_RESUMO_IA = '-ia';

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

export function camposDoFormulario(
  f: FormularioFeegow,
  caixaLivre: CampoFicha,
): Partial<Record<CampoFicha, string[]>> {
  const campos: Partial<Record<CampoFicha, string[]>> = {};
  const add = (campo: CampoFicha, html: string) => {
    if (htmlSemTexto(html)) return;
    (campos[campo] ??= []).push(html);
  };

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
