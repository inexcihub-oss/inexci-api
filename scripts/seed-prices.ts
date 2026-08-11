import 'dotenv/config';
import { Client } from 'pg';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- SDK Stripe usa namespace CJS com errors.StripeError
import StripeLib = require('stripe');

import {
  PlanoDoBanco,
  PrecoDoGateway,
  conferirPreco,
  mensagemPrecoInexistente,
  modoDaChave,
  resolverAlvos,
} from '../src/database/seeds/plan-prices';

/**
 * Sincroniza `subscription_plans.gateway_price_id` com os price IDs da Stripe,
 * validando cada um contra a API ANTES de gravar.
 *
 * Diferente do `yarn seed`, roda em produção: mexe só nesta coluna, é
 * idempotente e nunca cria nem apaga linha. É o caminho suportado para trocar
 * os preços — o `UPDATE` manual não conferia nada e foi como um price de test
 * mode entrou no banco de produção, derrubando o checkout com `No such price`.
 *
 * Uso:
 *   yarn seed:prices           grava os IDs válidos
 *   yarn seed:prices --check   só valida e relata (read-only)
 *
 * Saída: 0 tudo certo · 1 configuração ausente · 2 algum price inválido.
 */

const SOMENTE_CHECAGEM =
  process.argv.includes('--check') || process.argv.includes('--dry-run');

const TAG = '[seed-prices]';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!databaseUrl) {
    console.error(`${TAG} DATABASE_URL não definido.`);
    process.exit(1);
  }
  if (!secretKey) {
    console.error(
      `${TAG} STRIPE_SECRET_KEY não definida — sem ela não dá para validar os preços antes de gravar.`,
    );
    process.exit(1);
  }

  const modo = modoDaChave(secretKey);
  console.log(
    `${TAG} conta Stripe em modo ${modo}${SOMENTE_CHECAGEM ? ' · somente checagem (nada será gravado)' : ''}`,
  );

  const client = new Client({ connectionString: databaseUrl });
  const stripe = new StripeLib(secretKey, {
    apiVersion: '2026-06-24.dahlia',
    timeout: Number(process.env.STRIPE_REQUEST_TIMEOUT_MS ?? 15000),
    appInfo: { name: 'inexci-seed-prices', version: '1.0' },
  });

  let invalidos = 0;
  let gravados = 0;
  let inalterados = 0;

  try {
    await client.connect();

    const planos = await carregarPlanos(client);
    if (!planos.length) {
      console.error(
        `${TAG} nenhum plano ativo em subscription_plans. Rode as migrations antes.`,
      );
      process.exit(1);
    }

    const { alvos, semPriceId } = resolverAlvos(planos, process.env);
    const porSlug = new Map(planos.map((p) => [p.slug, p]));

    for (const alvo of alvos) {
      const plano = porSlug.get(alvo.slug)!;
      const preco = await buscarPreco(stripe, alvo.priceId);

      if (!preco) {
        console.error(`${TAG} ✗ ${mensagemPrecoInexistente(alvo, modo)}`);
        invalidos++;
        continue;
      }

      for (const aviso of conferirPreco(plano, preco)) {
        console.warn(`${TAG} ⚠ ${alvo.slug}: ${aviso}`);
      }

      if (alvo.jaGravado) {
        console.log(`${TAG} ✓ ${alvo.slug}: ${alvo.priceId} (já gravado)`);
        inalterados++;
        continue;
      }

      if (SOMENTE_CHECAGEM) {
        console.log(
          `${TAG} → ${alvo.slug}: gravaria ${alvo.priceId} (era ${plano.gatewayPriceId ?? 'NULL'})`,
        );
        continue;
      }

      await client.query(
        `UPDATE subscription_plans
            SET gateway_price_id = $1, updated_at = now()
          WHERE slug = $2`,
        [alvo.priceId, alvo.slug],
      );
      console.log(
        `${TAG} ✓ ${alvo.slug}: ${alvo.priceId} (era ${plano.gatewayPriceId ?? 'NULL'})`,
      );
      gravados++;
    }

    for (const slug of semPriceId) {
      // `enterprise` é "fale conosco" e não tem preço na Stripe de propósito.
      console.log(`${TAG} · ${slug}: sem price ID (não assinável pelo checkout)`);
    }

    console.log(
      `${TAG} resumo: ${gravados} gravado(s), ${inalterados} inalterado(s), ${invalidos} inválido(s), ${semPriceId.length} sem price ID`,
    );

    if (invalidos > 0) {
      console.error(
        `${TAG} FALHA: ${invalidos} price ID(s) não existem nesta conta. Nenhum deles foi gravado; os planos afetados continuam recusando o checkout até serem corrigidos.`,
      );
      process.exit(2);
    }
  } catch (erro) {
    console.error(`${TAG} erro inesperado: ${(erro as Error).message}`);
    process.exit(3);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function carregarPlanos(client: Client): Promise<PlanoDoBanco[]> {
  const { rows } = await client.query(
    `SELECT slug, gateway_price_id, price_cents, currency, billing_period
       FROM subscription_plans
      WHERE is_active = true
      ORDER BY sort_order`,
  );

  return rows.map((row) => ({
    slug: row.slug,
    gatewayPriceId: row.gateway_price_id,
    priceCents: Number(row.price_cents),
    currency: row.currency,
    billingPeriod: row.billing_period,
  }));
}

/** `null` quando o price não existe nesta conta/modo (404 da Stripe). */
async function buscarPreco(
  stripe: StripeLib.Stripe,
  priceId: string,
): Promise<PrecoDoGateway | null> {
  try {
    const preco = await stripe.prices.retrieve(priceId);
    return {
      id: preco.id,
      active: preco.active,
      unitAmount: preco.unit_amount ?? null,
      currency: preco.currency,
      interval:
        preco.recurring?.interval === 'year'
          ? 'year'
          : preco.recurring?.interval === 'month'
            ? 'month'
            : null,
    };
  } catch (erro) {
    if (
      erro instanceof StripeLib.errors.StripeError &&
      (erro.statusCode === 404 || erro.code === 'resource_missing')
    ) {
      return null;
    }
    throw erro;
  }
}

void main();
