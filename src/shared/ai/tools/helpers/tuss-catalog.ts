import {
  TussService,
  TussResponse,
} from '../../../../modules/tuss/tuss.service';

export type TussCatalogResolution =
  | { status: 'ok'; tussCode: string; name: string }
  | { status: 'ambiguous'; message: string }
  | { status: 'not_found'; message: string }
  | { status: 'missing'; message: string };

export function resolveTussFromCatalog(
  tussService: TussService,
  rawCode: string | null,
  rawName: string | null,
): TussCatalogResolution {
  if (!rawCode && !rawName) {
    return {
      status: 'missing',
      message:
        'Para adicionar TUSS, informe ao menos `tussCode` ou `name` (descrição). O sistema procura no catálogo e completa o que faltar.',
    };
  }

  if (rawCode) {
    const exact = tussService.findByExactCode(rawCode);
    if (exact) {
      return { status: 'ok', tussCode: exact.tussCode, name: exact.name };
    }

    const candidates = tussService.lookup(rawCode, 5);
    if (candidates.length === 0) {
      return {
        status: 'not_found',
        message: `Não encontrei o código TUSS "${rawCode}" no catálogo. Confira os dígitos ou descreva o procedimento para eu pesquisar.`,
      };
    }

    if (candidates.length === 1) {
      return {
        status: 'ok',
        tussCode: candidates[0].tussCode,
        name: candidates[0].name,
      };
    }

    return {
      status: 'ambiguous',
      message: [
        `Encontrei mais de um código TUSS começando com "${rawCode}":`,
        ...candidates.map((c) => `${c.tussCode} — ${c.name}`),
        'Confirme qual deles deve ser adicionado.',
      ].join('\n'),
    };
  }

  const candidates = tussService.lookup(rawName as string, 5);
  if (candidates.length === 0) {
    return {
      status: 'not_found',
      message: `Não encontrei nenhum código TUSS para "${rawName}". Tente um trecho diferente ou informe o código (mesmo parcial).`,
    };
  }

  if (candidates.length === 1) {
    return {
      status: 'ok',
      tussCode: candidates[0].tussCode,
      name: candidates[0].name,
    };
  }

  return {
    status: 'ambiguous',
    message: [
      `Encontrei mais de um código TUSS para "${rawName}":`,
      ...candidates.map((c: TussResponse) => `${c.tussCode} — ${c.name}`),
      'Confirme qual código você quer adicionar.',
    ].join('\n'),
  };
}
