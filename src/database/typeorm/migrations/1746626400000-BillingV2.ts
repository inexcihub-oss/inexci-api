import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration BillingV2 — reestrutura\u00e7\u00e3o completa do dom\u00ednio de planos e
 * cobran\u00e7a:
 *
 * - `subscription_plans` reformulado: cota agora \u00e9 por solicita\u00e7\u00f5es
 *   cir\u00fargicas enviadas/m\u00eas (em vez de CRMs), com pre\u00e7o e periodicidade.
 * - Novas tabelas: `subscriptions`, `payment_methods`, `invoices`,
 *   `subscription_quota_periods`, `payment_gateway_events`.
 * - Dropa `users.subscription_plan_id` (agora vive em `subscriptions`).
 * - Backfill: para cada admin/owner existente, cria uma assinatura TRIALING
 *   de 30 dias com o plano `free-trial`.
 */
export class BillingV21746626400000 implements MigrationInterface {
  name = 'BillingV21746626400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ───── 1. Drop FK + coluna antigas no users ─────
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP CONSTRAINT IF EXISTS "fk_users_subscription_plan";
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "subscription_plan_id";
    `);

    // ───── 2. Refactor subscription_plans ─────
    // Limpa os planos antigos (modelo por CRM) e recria com colunas novas.
    await queryRunner.query(`DELETE FROM "subscription_plans";`);

    await queryRunner.query(`
      ALTER TABLE "subscription_plans"
        DROP COLUMN IF EXISTS "max_doctors",
        ADD COLUMN "slug"                   VARCHAR(60),
        ADD COLUMN "price_cents"            INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN "currency"               VARCHAR(3) NOT NULL DEFAULT 'BRL',
        ADD COLUMN "billing_period"         VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',
        ADD COLUMN "surgery_request_quota"  INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN "is_trial_default"       BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN "sort_order"             INTEGER NOT NULL DEFAULT 0;
    `);

    await queryRunner.query(`
      ALTER TABLE "subscription_plans"
        ALTER COLUMN "slug" SET NOT NULL;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_subscription_plans_slug"
        ON "subscription_plans" ("slug");
    `);

    // Planos default. Ajuste pre\u00e7os/cotas conforme estrat\u00e9gia comercial.
    // 4 planos pagos + 1 plano "free-trial" usado como fallback quando o
    // cadastro n\u00e3o seleciona um plano espec\u00edfico (cota equivalente ao Starter).
    await queryRunner.query(`
      INSERT INTO "subscription_plans"
        (slug, name, description, price_cents, currency, billing_period, surgery_request_quota, is_active, is_trial_default, sort_order)
      VALUES
        ('free-trial',  'Free Trial',   'Teste grat\u00fato por 30 dias \u2014 use a plataforma sem compromisso',  0,     'BRL', 'MONTHLY',  20, true, true,  0),
        ('starter',     'Starter',      'Para m\u00e9dicos individuais come\u00e7ando agora',                       9900,  'BRL', 'MONTHLY',  20, true, false, 1),
        ('essencial',   'Essencial',    'Para cl\u00ednicas pequenas e equipes em crescimento',                 19900, 'BRL', 'MONTHLY',  60, true, false, 2),
        ('profissional','Profissional', 'Para cl\u00ednicas estabelecidas com alto volume cir\u00fargico',         39900, 'BRL', 'MONTHLY', 200, true, false, 3),
        ('enterprise',  'Enterprise',   'Para grandes hospitais e redes \u2014 volume ilimitado',              79900, 'BRL', 'MONTHLY',  -1, true, false, 4);
    `);

    // ───── 3. subscriptions ─────
    await queryRunner.query(`
      CREATE TABLE "subscriptions" (
        "id"                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    await queryRunner.query(`
      CREATE INDEX "idx_subscriptions_owner_id" ON "subscriptions" ("owner_id");
      CREATE INDEX "idx_subscriptions_status" ON "subscriptions" ("status");
      CREATE INDEX "idx_subscriptions_gateway_subscription_id"
        ON "subscriptions" ("gateway_subscription_id");
    `);

    // ───── 4. payment_methods ─────
    await queryRunner.query(`
      CREATE TABLE "payment_methods" (
        "id"                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
      CREATE INDEX "idx_payment_methods_owner_id" ON "payment_methods" ("owner_id");
    `);

    // FK do default_payment_method_id apontando para payment_methods
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        ADD CONSTRAINT "fk_subscriptions_default_pm"
          FOREIGN KEY ("default_payment_method_id")
          REFERENCES "payment_methods"("id") ON DELETE SET NULL;
    `);

    // ───── 5. invoices ─────
    await queryRunner.query(`
      CREATE TABLE "invoices" (
        "id"                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
      CREATE UNIQUE INDEX "idx_invoices_gateway_invoice_id" ON "invoices" ("gateway_invoice_id");
      CREATE INDEX "idx_invoices_owner_id" ON "invoices" ("owner_id");
      CREATE INDEX "idx_invoices_subscription_id" ON "invoices" ("subscription_id");
      CREATE INDEX "idx_invoices_status" ON "invoices" ("status");
    `);

    // ───── 6. subscription_quota_periods ─────
    await queryRunner.query(`
      CREATE TABLE "subscription_quota_periods" (
        "id"                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
      CREATE INDEX "idx_quota_periods_subscription_id"
        ON "subscription_quota_periods" ("subscription_id");
      CREATE UNIQUE INDEX "idx_quota_periods_subscription_period"
        ON "subscription_quota_periods" ("subscription_id", "period_start");
    `);

    // ───── 7. payment_gateway_events ─────
    await queryRunner.query(`
      CREATE TABLE "payment_gateway_events" (
        "id"                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "gateway_provider"    VARCHAR(30) NOT NULL,
        "event_id"            VARCHAR(200) NOT NULL,
        "event_type"          VARCHAR(60) NOT NULL,
        "payload"             JSONB NOT NULL,
        "processed_at"        TIMESTAMPTZ,
        "error"               TEXT,
        "created_at"          TIMESTAMP NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX "idx_payment_gateway_events_provider_event"
        ON "payment_gateway_events" ("gateway_provider", "event_id");
      CREATE INDEX "idx_payment_gateway_events_processed_at"
        ON "payment_gateway_events" ("processed_at");
    `);

    // ───── 8. Backfill: trial autom\u00e1tico para admins existentes ─────
    // Cada owner (admin com owner_id = self.id) recebe uma assinatura
    // TRIALING de 30 dias no plano `free-trial`.
    await queryRunner.query(`
      INSERT INTO "subscriptions" (
        owner_id, plan_id, status,
        trial_ends_at, current_period_start, current_period_end,
        gateway_provider
      )
      SELECT
        u.id,
        (SELECT id FROM subscription_plans WHERE slug = 'free-trial'),
        'trialing',
        now() + INTERVAL '30 days',
        now(),
        now() + INTERVAL '30 days',
        'asaas'
      FROM "users" u
      WHERE u.role = 'admin'
        AND u.id = u.owner_id
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions s WHERE s.owner_id = u.id
        );
    `);

    // Cria o primeiro per\u00edodo de cota para cada subscription criada
    await queryRunner.query(`
      INSERT INTO "subscription_quota_periods" (
        subscription_id, period_start, period_end,
        surgery_requests_limit, surgery_requests_used
      )
      SELECT
        s.id,
        s.current_period_start,
        s.current_period_end,
        p.surgery_request_quota,
        0
      FROM "subscriptions" s
      INNER JOIN "subscription_plans" p ON p.id = s.plan_id
      WHERE NOT EXISTS (
        SELECT 1 FROM subscription_quota_periods q
        WHERE q.subscription_id = s.id
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_gateway_events";`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "subscription_quota_periods";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "invoices";`);
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        DROP CONSTRAINT IF EXISTS "fk_subscriptions_default_pm";
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_methods";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subscriptions";`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_subscription_plans_slug";`,
    );
    await queryRunner.query(`
      ALTER TABLE "subscription_plans"
        DROP COLUMN IF EXISTS "slug",
        DROP COLUMN IF EXISTS "price_cents",
        DROP COLUMN IF EXISTS "currency",
        DROP COLUMN IF EXISTS "billing_period",
        DROP COLUMN IF EXISTS "surgery_request_quota",
        DROP COLUMN IF EXISTS "is_trial_default",
        DROP COLUMN IF EXISTS "sort_order",
        ADD COLUMN "max_doctors" INTEGER NOT NULL DEFAULT 1;
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "subscription_plan_id" UUID,
        ADD CONSTRAINT "fk_users_subscription_plan"
          FOREIGN KEY ("subscription_plan_id")
          REFERENCES "subscription_plans"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
    `);
  }
}
