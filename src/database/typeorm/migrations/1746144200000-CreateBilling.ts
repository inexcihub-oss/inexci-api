import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Billing — assinaturas, cobrança e cotas.
 *
 * Modelo Stripe Checkout + Customer Portal:
 * - Stripe é a fonte da verdade para pagamentos.
 * - `subscription_plans.gateway_price_id` guarda o Price ID da Stripe.
 * - `payment_methods` e `invoices` foram removidas: cartões e faturas
 *   ficam exclusivamente no Customer Portal da Stripe.
 * - `default_payment_method_id` e `next_plan_id` removidos de `subscriptions`.
 *
 * Tabelas: subscription_plans, subscriptions,
 *          subscription_quota_periods, payment_gateway_events.
 *
 * Price IDs populados via `yarn seed:prices` após configurar as vars
 * STRIPE_PRICE_* no .env.
 */
export class CreateBilling1746144200000 implements MigrationInterface {
  name = 'CreateBilling1746144200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "subscription_plans" (
        "id"                    UUID NOT NULL DEFAULT gen_random_uuid(),
        "slug"                  VARCHAR(60) NOT NULL,
        "name"                  VARCHAR(100) NOT NULL,
        "description"           TEXT,
        "price_cents"           INTEGER NOT NULL DEFAULT 0,
        "currency"              VARCHAR(3) NOT NULL DEFAULT 'BRL',
        "billing_period"        VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',
        "surgery_request_quota" INTEGER NOT NULL DEFAULT 0,
        "gateway_price_id"      VARCHAR(100),
        "is_active"             BOOLEAN NOT NULL DEFAULT true,
        "is_trial_default"      BOOLEAN NOT NULL DEFAULT false,
        "sort_order"            INTEGER NOT NULL DEFAULT 0,
        "created_at"            TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"            TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_subscription_plans" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_subscription_plans_slug" ON "subscription_plans" ("slug");`,
    );

    await queryRunner.query(`
      CREATE TABLE "subscriptions" (
        "id"                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "owner_id"                    UUID NOT NULL,
        "plan_id"                     UUID NOT NULL,
        "status"                      VARCHAR(20) NOT NULL DEFAULT 'trialing',
        "trial_ends_at"               TIMESTAMPTZ,
        "current_period_start"        TIMESTAMPTZ NOT NULL,
        "current_period_end"          TIMESTAMPTZ NOT NULL,
        "past_due_since"              TIMESTAMPTZ,
        "cancel_at_period_end"        BOOLEAN NOT NULL DEFAULT false,
        "canceled_at"                 TIMESTAMPTZ,
        "suspended_at"                TIMESTAMPTZ,
        "gateway_provider"            VARCHAR(30) NOT NULL,
        "gateway_customer_id"         VARCHAR(100),
        "gateway_subscription_id"     VARCHAR(100),
        "created_at"                  TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"                  TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_subscriptions_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_subscriptions_plan"
          FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_subscriptions_owner_id" ON "subscriptions" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_subscriptions_status" ON "subscriptions" ("status");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_subscriptions_gateway_subscription_id" ON "subscriptions" ("gateway_subscription_id");`,
    );

    await queryRunner.query(`
      CREATE TABLE "subscription_quota_periods" (
        "id"                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "subscription_id"         UUID NOT NULL,
        "period_start"            TIMESTAMPTZ NOT NULL,
        "period_end"              TIMESTAMPTZ NOT NULL,
        "surgery_requests_limit"  INTEGER NOT NULL,
        "surgery_requests_used"   INTEGER NOT NULL DEFAULT 0,
        "created_at"              TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"              TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_quota_periods_subscription"
          FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_quota_periods_subscription_id" ON "subscription_quota_periods" ("subscription_id");`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_quota_periods_subscription_period" ON "subscription_quota_periods" ("subscription_id", "period_start");`,
    );

    await queryRunner.query(`
      CREATE TABLE "payment_gateway_events" (
        "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "gateway_provider" VARCHAR(30) NOT NULL,
        "event_id"         VARCHAR(200) NOT NULL,
        "event_type"       VARCHAR(60) NOT NULL,
        "payload"          JSONB NOT NULL,
        "processed_at"     TIMESTAMPTZ,
        "error"            TEXT,
        "created_at"       TIMESTAMP NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_payment_gateway_events_provider_event" ON "payment_gateway_events" ("gateway_provider", "event_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payment_gateway_events_processed_at" ON "payment_gateway_events" ("processed_at");`,
    );

    await queryRunner.query(`
      INSERT INTO subscription_plans
        (slug, name, description, price_cents, currency, billing_period, surgery_request_quota, gateway_price_id, is_active, is_trial_default, sort_order)
      VALUES
        ('starter',             'Starter',             'Ideal para médicos individuais começando agora',             45800,   'BRL', 'MONTHLY',  10, NULL, true,  true,  1),
        ('starter-anual',       'Starter Anual',       'Ideal para médicos individuais começando agora',             444000,  'BRL', 'YEARLY',   10, NULL, true,  false, 2),
        ('essencial',           'Essencial',           'Para clínicas pequenas e equipes em crescimento',            63400,   'BRL', 'MONTHLY',  20, NULL, true,  false, 3),
        ('essencial-anual',     'Essencial Anual',     'Para clínicas pequenas e equipes em crescimento',            655200,  'BRL', 'YEARLY',   20, NULL, true,  false, 4),
        ('profissional',        'Profissional',        'Para clínicas estabelecidas com alto volume cirúrgico',      81000,   'BRL', 'MONTHLY',  40, NULL, true,  false, 5),
        ('profissional-anual',  'Profissional Anual',  'Para clínicas estabelecidas com alto volume cirúrgico',      866400,  'BRL', 'YEARLY',   40, NULL, true,  false, 6),
        ('avancado',            'Avançado',            'Para grandes equipes com volume intenso de procedimentos',   98600,   'BRL', 'MONTHLY',  50, NULL, true,  false, 7),
        ('avancado-anual',      'Avançado Anual',      'Para grandes equipes com volume intenso de procedimentos',   1077600, 'BRL', 'YEARLY',   50, NULL, true,  false, 8),
        ('enterprise',          'Enterprise',          'Acima de 50 solicitações por mês — vamos conversar',        0,       'BRL', 'MONTHLY',  -1, NULL, true,  false, 9)
      ON CONFLICT (slug) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      'payment_gateway_events',
      'subscription_quota_periods',
      'subscriptions',
      'subscription_plans',
    ];
    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE;`);
    }
  }
}
