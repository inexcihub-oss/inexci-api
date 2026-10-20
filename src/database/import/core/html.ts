import * as sanitizeHtml from 'sanitize-html';
import { decodificarEntidadesHtml } from './normalizers';

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
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'title'],
};

function separarBlocosDescartados(
  html: string,
  quebra: string,
  separadorDeCelula: string,
): string {
  return html
    .replace(/<\/t[dh]>\s*(?=<t[dh][\s>])/gi, separadorDeCelula)
    .replace(
      /<\/(tr|div|table|dt|dd|h5|h6|pre|address|section|article)>/gi,
      quebra,
    )
    .replace(
      /([^>\s])([ \t]*)(<(?:table|div|section|article)(?:\s[^>]*)?>)/gi,
      (_, antes: string, espaco: string, tag: string) =>
        antes + espaco + quebra + tag,
    );
}

export function htmlSemTexto(html: string | null | undefined): boolean {
  return !/[\p{L}\p{N}]/u.test(
    decodificarEntidadesHtml((html ?? '').replace(/<[^>]*>/g, ' ')),
  );
}

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
