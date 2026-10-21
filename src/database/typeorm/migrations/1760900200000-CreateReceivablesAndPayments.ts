import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  TABELAS_DE_COBRANCA,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

export class CreateReceivablesAndPayments1760900200000 implements MigrationInterface {
  name = 'CreateReceivablesAndPayments1760900200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const conflitos = await verificar(TABELAS_DE_COBRANCA, (sql) =>
      queryRunner.query(sql),
    );
    if (conflitos.length > 0) {
      throw new Error(montarDiagnostico(TABELAS_DE_COBRANCA, conflitos));
    }

    await queryRunner.query(`
      CREATE TABLE "receivables" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" uuid NOT NULL,
        "patient_id" uuid NOT NULL,
        "appointment_id" uuid,
        "reference_date" date NOT NULL,
        "due_date" date,
        "total_amount" numeric(12,2) NOT NULL DEFAULT 0,
        "paid_amount" numeric(12,2) NOT NULL DEFAULT 0,
        "status" character varying(20) NOT NULL DEFAULT 'open',
        "cancelled_at" TIMESTAMP WITH TIME ZONE,
        "cancel_reason" text,
        "cancelled_by_id" uuid,
        "notes" text,
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_receivables" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_receivables_paid_amount_non_negative"
          CHECK ("paid_amount" >= 0),
        CONSTRAINT "FK_receivables_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_receivables_patient"
          FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_receivables_appointment"
          FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_receivables_cancelled_by"
          FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_receivables_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_receivables_owner_status_due_date" ON "receivables" ("owner_id", "status", "due_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_receivables_patient_id" ON "receivables" ("patient_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_receivables_appointment_id" ON "receivables" ("appointment_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_receivables_owner_reference_date" ON "receivables" ("owner_id", "reference_date")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_receivables_appointment_active" ON "receivables" ("appointment_id") WHERE "status" <> 'cancelled' AND "appointment_id" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "receivable_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" uuid NOT NULL,
        "receivable_id" uuid NOT NULL,
        "appointment_id" uuid,
        "description" character varying(150) NOT NULL,
        "executed_by_id" uuid,
        "executed_at" date,
        "quantity" integer NOT NULL DEFAULT 1,
        "unit_amount" numeric(12,2) NOT NULL,
        "discount" numeric(12,2) NOT NULL DEFAULT 0,
        "surcharge" numeric(12,2) NOT NULL DEFAULT 0,
        "total" numeric(12,2) NOT NULL,
        "cancelled_at" TIMESTAMP WITH TIME ZONE,
        "cancelled_by_id" uuid,
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_receivable_items" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_receivable_items_quantity_positive"
          CHECK ("quantity" >= 1),
        CONSTRAINT "CHK_receivable_items_discount_non_negative"
          CHECK ("discount" >= 0),
        CONSTRAINT "CHK_receivable_items_surcharge_non_negative"
          CHECK ("surcharge" >= 0),
        CONSTRAINT "FK_receivable_items_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_receivable_items_receivable"
          FOREIGN KEY ("receivable_id") REFERENCES "receivables"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_receivable_items_appointment"
          FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_receivable_items_executed_by"
          FOREIGN KEY ("executed_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_receivable_items_cancelled_by"
          FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_receivable_items_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_receivable_items_receivable_id" ON "receivable_items" ("receivable_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_receivable_items_executed_by_executed_at" ON "receivable_items" ("executed_by_id", "executed_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_receivable_items_appointment_id" ON "receivable_items" ("appointment_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" uuid NOT NULL,
        "receivable_id" uuid NOT NULL,
        "method" character varying(20) NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "refunded_amount" numeric(12,2) NOT NULL DEFAULT 0,
        "paid_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "account_id" uuid,
        "cash_session_id" uuid,
        "received_by_id" uuid,
        "card_brand" character varying(30),
        "installments" integer NOT NULL DEFAULT 1,
        "nsu" character varying(40),
        "authorization_code" character varying(40),
        "notes" text,
        "idempotency_key" uuid,
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payments" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_payments_amount_positive"
          CHECK ("amount" > 0),
        CONSTRAINT "CHK_payments_refunded_amount_range"
          CHECK ("refunded_amount" >= 0 AND "refunded_amount" <= "amount"),
        CONSTRAINT "FK_payments_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_payments_receivable"
          FOREIGN KEY ("receivable_id") REFERENCES "receivables"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_payments_account"
          FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_payments_cash_session"
          FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_payments_received_by"
          FOREIGN KEY ("received_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_payments_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_payments_owner_paid_at" ON "payments" ("owner_id", "paid_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payments_cash_session_id" ON "payments" ("cash_session_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payments_receivable_id" ON "payments" ("receivable_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payments_account_id" ON "payments" ("account_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_payments_owner_idempotency_key" ON "payments" ("owner_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "refunds" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" uuid NOT NULL,
        "payment_id" uuid NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "reason" character varying(40) NOT NULL,
        "notes" text,
        "account_id" uuid,
        "cash_session_id" uuid,
        "refunded_by_id" uuid,
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refunds" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_refunds_amount_positive"
          CHECK ("amount" > 0),
        CONSTRAINT "FK_refunds_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_refunds_payment"
          FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_refunds_account"
          FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_refunds_cash_session"
          FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_refunds_refunded_by"
          FOREIGN KEY ("refunded_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_refunds_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_refunds_payment_id" ON "refunds" ("payment_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refunds_owner_created_at" ON "refunds" ("owner_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refunds_cash_session_id" ON "refunds" ("cash_session_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "financial_entries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" uuid NOT NULL,
        "account_id" uuid,
        "cash_session_id" uuid,
        "direction" character varying(3) NOT NULL,
        "kind" character varying(20) NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "payment_id" uuid,
        "refund_id" uuid,
        "counterpart_entry_id" uuid,
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "description" character varying(255),
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_financial_entries" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_financial_entries_account_xor_cash_session"
          CHECK (("account_id" IS NOT NULL) <> ("cash_session_id" IS NOT NULL)),
        CONSTRAINT "CHK_financial_entries_amount_positive"
          CHECK ("amount" > 0),
        CONSTRAINT "FK_financial_entries_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_financial_entries_account"
          FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_financial_entries_cash_session"
          FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_financial_entries_payment"
          FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_financial_entries_refund"
          FOREIGN KEY ("refund_id") REFERENCES "refunds"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_financial_entries_counterpart_entry"
          FOREIGN KEY ("counterpart_entry_id") REFERENCES "financial_entries"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_financial_entries_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_financial_entries_account_occurred_at" ON "financial_entries" ("account_id", "occurred_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_financial_entries_cash_session_id" ON "financial_entries" ("cash_session_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_financial_entries_owner_occurred_at" ON "financial_entries" ("owner_id", "occurred_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_financial_entries_payment_id" ON "financial_entries" ("payment_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_financial_entries_refund_id" ON "financial_entries" ("refund_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_financial_entries_counterpart_entry_id" ON "financial_entries" ("counterpart_entry_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "payment_receipt_issues" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" uuid NOT NULL,
        "payment_id" uuid NOT NULL,
        "issued_by_id" uuid,
        "with_signature" boolean NOT NULL DEFAULT false,
        "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_receipt_issues" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payment_receipt_issues_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_payment_receipt_issues_payment"
          FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_payment_receipt_issues_issued_by"
          FOREIGN KEY ("issued_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_payment_receipt_issues_payment_id" ON "payment_receipt_issues" ("payment_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payment_receipt_issues_issued_by_id" ON "payment_receipt_issues" ("issued_by_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_receipt_issues"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "financial_entries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refunds"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "receivable_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "receivables"`);
  }
}
