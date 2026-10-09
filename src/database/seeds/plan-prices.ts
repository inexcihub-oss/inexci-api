export const SLUG_PARA_ENV: Readonly<Record<string, string>> = {
  starter: 'STRIPE_PRICE_STARTER_MONTHLY',
  'starter-anual': 'STRIPE_PRICE_STARTER_YEARLY',
  essencial: 'STRIPE_PRICE_ESSENCIAL_MONTHLY',
  'essencial-anual': 'STRIPE_PRICE_ESSENCIAL_YEARLY',
  profissional: 'STRIPE_PRICE_PROFISSIONAL_MONTHLY',
  'profissional-anual': 'STRIPE_PRICE_PROFISSIONAL_YEARLY',
  avancado: 'STRIPE_PRICE_AVANCADO_MONTHLY',
  'avancado-anual': 'STRIPE_PRICE_AVANCADO_YEARLY',
};

export interface PlanoDoBanco {
  slug: string;
  gatewayPriceId: string | null;
  priceCents: number;
  currency: string;
  billingPeriod: 'MONTHLY' | 'YEARLY';
}

export interface PrecoDoGateway {
  id: string;
  active: boolean;
  unitAmount: number | null;
  currency: string;
  interval: 'month' | 'year' | null;
}

export type OrigemDoAlvo = 'env' | 'banco';

export interface AlvoDePreco {
  slug: string;
  priceId: string;
  origem: OrigemDoAlvo;
  jaGravado: boolean;
}

export interface Alvos {
  alvos: AlvoDePreco[];
  semPriceId: string[];
}

export function resolverAlvos(
  planos: readonly PlanoDoBanco[],
  env: Record<string, string | undefined>,
): Alvos {
  const alvos: AlvoDePreco[] = [];
  const semPriceId: string[] = [];

  for (const plano of planos) {
    const nomeDaVar = SLUG_PARA_ENV[plano.slug];
    const doEnv = nomeDaVar ? env[nomeDaVar]?.trim() : undefined;
    const priceId = doEnv || plano.gatewayPriceId?.trim() || null;

    if (!priceId) {
      semPriceId.push(plano.slug);
      continue;
    }

    alvos.push({
      slug: plano.slug,
      priceId,
      origem: doEnv ? 'env' : 'banco',
      jaGravado: plano.gatewayPriceId === priceId,
    });
  }

  return { alvos, semPriceId };
}

export function conferirPreco(
  plano: PlanoDoBanco,
  preco: PrecoDoGateway,
): string[] {
  const avisos: string[] = [];

  if (!preco.active) {
    avisos.push('preço está arquivado (inactive) na Stripe');
  }

  if (preco.unitAmount !== null && preco.unitAmount !== plano.priceCents) {
    avisos.push(
      `valor diverge: banco ${formatarCentavos(plano.priceCents)} vs Stripe ${formatarCentavos(preco.unitAmount)}`,
    );
  }

  if (preco.currency.toUpperCase() !== plano.currency.toUpperCase()) {
    avisos.push(
      `moeda diverge: banco ${plano.currency.toUpperCase()} vs Stripe ${preco.currency.toUpperCase()}`,
    );
  }

  const intervaloEsperado = plano.billingPeriod === 'YEARLY' ? 'year' : 'month';
  if (preco.interval !== null && preco.interval !== intervaloEsperado) {
    avisos.push(
      `periodicidade diverge: banco ${plano.billingPeriod} espera "${intervaloEsperado}", Stripe tem "${preco.interval}"`,
    );
  }

  return avisos;
}

export type ModoDaChave = 'live' | 'test' | 'desconhecido';

export function modoDaChave(secretKey: string | undefined): ModoDaChave {
  if (!secretKey) return 'desconhecido';
  if (secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_')) {
    return 'live';
  }
  if (secretKey.startsWith('sk_test_') || secretKey.startsWith('rk_test_')) {
    return 'test';
  }
  return 'desconhecido';
}

export function mensagemPrecoInexistente(
  alvo: AlvoDePreco,
  modo: ModoDaChave,
): string {
  const outroModo = modo === 'live' ? 'test' : 'live';
  const origem =
    alvo.origem === 'env'
      ? `informado em ${SLUG_PARA_ENV[alvo.slug] ?? 'STRIPE_PRICE_*'}`
      : 'gravado no banco';

  const dica =
    modo === 'desconhecido'
      ? 'Confira em qual modo (test/live) esse price existe e se a STRIPE_SECRET_KEY é do mesmo modo.'
      : `A STRIPE_SECRET_KEY em uso é do modo ${modo}. Procure esse ID no dashboard com o toggle "Test mode" ligado: se ele aparecer lá, o banco está com preços de ${outroModo}.`;

  return `${alvo.slug}: price "${alvo.priceId}" (${origem}) não existe nesta conta Stripe. ${dica}`;
}

function formatarCentavos(centavos: number): string {
  return (centavos / 100).toFixed(2);
}
