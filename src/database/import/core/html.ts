import * as sanitizeHtml from 'sanitize-html';
import { decodificarEntidadesHtml } from './normalizers';

/**
 * Mesma allowlist dos campos clínicos/laudos (`clinical-report-sections.util`)
 * mais `h4`, usado nos cabeçalhos de bloco da importação. O conteúdo vem do
 * CKEditor do Feegow: tabelas, `font`, `select` e afins perdem a tag e ficam
 * só com o texto.
 */
const OPCOES: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'blockquote',
    'span',
  ],
  allowedAttributes: {},
  disallowedTagsMode: 'discard',
  // Conteúdo de <style>/<script> some junto com a tag.
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'title'],
};

/**
 * Separadores para os blocos que a allowlist descarta. Em modo `discard` o
 * `sanitize-html` tira a tag e cola o texto vizinho: `<td>Dipirona</td><td>
 * 500mg</td>` viraria `Dipirona500mg`. Antes de sanitizar, célula vizinha
 * ganha ` | ` e fim de linha de tabela/`div`/bloco ganha quebra.
 */
function separarBlocosDescartados(
  html: string,
  quebra: string,
  separadorDeCelula: string,
): string {
  return (
    html
      .replace(/<\/t[dh]>\s*(?=<t[dh][\s>])/gi, separadorDeCelula)
      .replace(
        /<\/(tr|div|table|dt|dd|h5|h6|pre|address|section|article)>/gi,
        quebra,
      )
      // Bloco aberto logo depois de texto solto (`Texto<div>…`) também quebra;
      // depois de outra tag, a quebra do fechamento anterior já basta.
      .replace(
        /([^>\s])([ \t]*)(<(?:table|div|section|article)(?:\s[^>]*)?>)/gi,
        (_, antes: string, espaco: string, tag: string) =>
          antes + espaco + quebra + tag,
      )
  );
}

/** Texto "vazio" de verdade: sem letra nem número depois de tirar as tags. */
export function htmlSemTexto(html: string | null | undefined): boolean {
  return !/[\p{L}\p{N}]/u.test(
    decodificarEntidadesHtml((html ?? '').replace(/<[^>]*>/g, ' ')),
  );
}

/**
 * HTML do Feegow → HTML seguro para a ficha. `&nbsp;` vira espaço (o CKEditor
 * enche o texto deles), quebras de linha cruas viram `<br>` e parágrafos e
 * quebras vazias nas pontas saem.
 */
export function sanitizarHtmlClinico(html: string | null | undefined): string {
  const bruto = (html ?? '')
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '<br>');
  return sanitizeHtml(separarBlocosDescartados(bruto, '<br>', ' | '), OPCOES)
    .replace(/<p>(\s|<br\s*\/?>)*<\/p>/g, '')
    .replace(/^(\s|<br\s*\/?>)+|(\s|<br\s*\/?>)+$/g, '')
    .replace(/(<br\s*\/?>\s*){3,}/g, '<br /><br />')
    .trim();
}

/**
 * HTML → texto puro com quebras de linha (os modelos de atestado guardam
 * texto: o PDF imprime o campo escapado, com `white-space: pre-line`).
 */
export function htmlParaTexto(html: string | null | undefined): string {
  const comQuebras = separarBlocosDescartados(
    (html ?? '').replace(/\r\n?/g, '\n'),
    '\n',
    ' | ',
  )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ');
  const texto = sanitizeHtml(comQuebras, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'title'],
  });
  return decodificarEntidadesHtml(texto)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
