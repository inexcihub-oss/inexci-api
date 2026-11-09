import { Logger } from '@nestjs/common';
import type { PaymentGateway } from 'src/shared/payment-gateway/payment-gateway.interface';
import type { InvoiceMirrorService } from 'src/modules/billing/services/invoice-mirror.service';
import type { SubscriptionRepository } from 'src/database/repositories/subscription.repository';
import { discountColumnsFrom } from 'src/modules/billing/subscription-discount';

export interface BackfillInvoicesDeps {
  gateway: Pick<PaymentGateway, 'listInvoices'>;
  mirror: Pick<InvoiceMirrorService, 'upsertFromGateway'>;
  createdFrom?: Date;
  pageSize?: number;
  log: (message: string) => void;
}

export interface BackfillInvoicesResult {
  pages: number;
  upserted: number;
  failed: number;
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGES = 10_000;

export async function backfillInvoices(
  deps: BackfillInvoicesDeps,
): Promise<BackfillInvoicesResult> {
  const limit = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const result: BackfillInvoicesResult = { pages: 0, upserted: 0, failed: 0 };
  let startingAfter: string | undefined;

  while (result.pages < MAX_PAGES) {
    const page = await deps.gateway.listInvoices({
      limit,
      createdFrom: deps.createdFrom,
      startingAfter,
    });
    result.pages++;

    for (const invoice of page.items) {
      try {
        await deps.mirror.upsertFromGateway(invoice);
        result.upserted++;
      } catch (err) {
        result.failed++;
        deps.log(
          `falha ao espelhar ${invoice.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    deps.log(
      `página ${result.pages}: ${page.items.length} faturas (total ${result.upserted}, falhas ${result.failed})`,
    );

    if (!page.hasMore || !page.nextStartingAfter) break;
    startingAfter = page.nextStartingAfter;
  }
  return result;
}

export interface BackfillDiscountsDeps {
  subscriptions: Pick<
    SubscriptionRepository,
    'findWithGatewaySubscription' | 'updateUnlessInternal'
  >;
  gateway: Pick<PaymentGateway, 'getSubscriptionWithDiscount'>;
  log: (message: string) => void;
}

export async function backfillSubscriptionDiscounts(
  deps: BackfillDiscountsDeps,
): Promise<{ updated: number; skipped: number; failed: number }> {
  const result = { updated: 0, skipped: 0, failed: 0 };
  const subs = await deps.subscriptions.findWithGatewaySubscription();
  for (const sub of subs) {
    const gatewayId = sub.gatewaySubscriptionId as string;
    try {
      const remote = await deps.gateway.getSubscriptionWithDiscount(gatewayId);
      if (!remote || remote.discount === undefined) {
        result.skipped++;
        continue;
      }
      const applied = await deps.subscriptions.updateUnlessInternal(
        sub.id,
        discountColumnsFrom(remote.discount),
      );
      if (applied) result.updated++;
      else result.skipped++;
    } catch (err) {
      result.failed++;
      deps.log(
        `falha ao ler o desconto de ${gatewayId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  deps.log(
    `descontos: ${result.updated} gravados, ${result.skipped} sem mudança, ${result.failed} falhas`,
  );
  return result;
}

export function parseBackfillArgs(argv: string[]): { createdFrom?: Date } {
  const arg = argv.find((a) => a.startsWith('--from='));
  if (!arg) return { createdFrom: undefined };
  const value = arg.slice('--from='.length);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(NaN);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`--from inválido: "${value}" (use AAAA-MM-DD)`);
  }
  return { createdFrom: date };
}

async function main(): Promise<void> {
  const logger = new Logger('BackfillInvoices');
  const { createdFrom } = parseBackfillArgs(process.argv.slice(2));

  const { SeedDataSource } = await import('../typeorm/seed-data-source');
  const { ConfigService } = await import('@nestjs/config');
  const { GatewayInvoice } = await import('../entities/gateway-invoice.entity');
  const { Subscription } = await import('../entities/subscription.entity');
  const { GatewayInvoiceRepository } =
    await import('../repositories/gateway-invoice.repository');
  const { SubscriptionRepository } =
    await import('../repositories/subscription.repository');
  const { StripeProvider } =
    await import('../../shared/payment-gateway/providers/stripe/stripe.provider');
  const { InvoiceMirrorService } =
    await import('../../modules/billing/services/invoice-mirror.service');

  if (!process.env.STRIPE_SECRET_KEY) {
    logger.error('STRIPE_SECRET_KEY não definida.');
    process.exit(1);
  }

  await SeedDataSource.initialize();
  try {
    const gateway = new StripeProvider(new ConfigService(process.env));
    const subscriptions = new SubscriptionRepository(
      SeedDataSource.getRepository(Subscription),
    );
    const mirror = new InvoiceMirrorService(
      new GatewayInvoiceRepository(
        SeedDataSource.getRepository(GatewayInvoice),
      ),
      subscriptions,
      gateway,
    );
    const result = await backfillInvoices({
      gateway,
      mirror,
      createdFrom,
      log: (message) => logger.log(message),
    });
    logger.log(
      `concluído: ${result.upserted} faturas espelhadas em ${result.pages} páginas, ${result.failed} falhas`,
    );
    const discounts = await backfillSubscriptionDiscounts({
      subscriptions,
      gateway,
      log: (message) => logger.log(message),
    });
    if (result.failed > 0 || discounts.failed > 0) process.exitCode = 1;
  } finally {
    await SeedDataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    new Logger('BackfillInvoices').error(
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  });
}
