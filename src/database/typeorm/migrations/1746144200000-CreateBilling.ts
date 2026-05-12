import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Billing — assinaturas, cobrança e cotas.
 *
 * Quota é por solicitações cirúrgicas enviadas/mês (-1 = ilimitado).
 * Os planos default são populados pelo seed (`yarn seed`), não pela
 * migration — ver `inexci-api/src/database/seeds/seed.ts`.
 *
 * Tabelas: subscription_plans, subscriptions, payment_methods, invoices,
 * subscription_quota_periods, payment_gateway_events.
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
        "next_plan_id"                UUID,
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
        "default_payment_method_id"   UUID,
        "created_at"                  TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"                  TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_subscriptions_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_subscriptions_plan"
          FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_subscriptions_next_plan"
          FOREIGN KEY ("next_plan_id") REFERENCES "subscription_plans"("id") ON DELETE SET NULL
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
      CREATE TABLE "payment_methods" (
        "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "owner_id"            UUID NOT NULL,
        "gateway_provider"    VARCHAR(30) NOT NULL,
        "gateway_token"       VARCHAR(255) NOT NULL,
        "gateway_customer_id" VARCHAR(100),
        "brand"               VARCHAR(30) NOT NULL,
        "last4"               CHAR(4) NOT NULL,
        "holder_name"         VARCHAR(100) NOT NULL,
        "exp_month"           SMALLINT NOT NULL,
        "exp_year"            SMALLINT NOT NULL,
        "is_default"          BOOLEAN NOT NULL DEFAULT true,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at"          TIMESTAMP,
        CONSTRAINT "fk_payment_methods_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_payment_methods_owner_id" ON "payment_methods" ("owner_id");`,
    );

    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        ADD CONSTRAINT "fk_subscriptions_default_pm"
          FOREIGN KEY ("default_payment_method_id")
          REFERENCES "payment_methods"("id") ON DELETE SET NULL;
    `);

    await queryRunner.query(`
      CREATE TABLE "invoices" (
        "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "subscription_id"       UUID NOT NULL,
        "owner_id"              UUID NOT NULL,
        "amount_cents"          INTEGER NOT NULL,
        "currency"              VARCHAR(3) NOT NULL DEFAULT 'BRL',
        "status"                VARCHAR(20) NOT NULL DEFAULT 'pending',
        "gateway_provider"      VARCHAR(30) NOT NULL,
        "gateway_invoice_id"    VARCHAR(100) NOT NULL,
        "invoice_url"           VARCHAR(500),
        "due_date"              TIMESTAMPTZ NOT NULL,
        "paid_at"               TIMESTAMPTZ,
        "failed_at"             TIMESTAMPTZ,
        "attempt_count"         INTEGER NOT NULL DEFAULT 0,
        "period_start"          TIMESTAMPTZ NOT NULL,
        "period_end"            TIMESTAMPTZ NOT NULL,
        "plan_snapshot"         JSONB,
        "created_at"            TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"            TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "fk_invoices_subscription"
          FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_invoices_gateway_invoice_id" ON "invoices" ("gateway_invoice_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_invoices_owner_id" ON "invoices" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_invoices_subscription_id" ON "invoices" ("subscription_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_invoices_status" ON "invoices" ("status");`,
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      'payment_gateway_events',
      'subscription_quota_periods',
      'invoices',
      'payment_methods',
      'subscriptions',
      'subscription_plans',
    ];
    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE;`);
    }
  }
}
