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
  return sanitizeHtml(bruto, OPCOES)
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
  const comQuebras = (html ?? '')
    .replace(/\r\n?/g, '\n')
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
