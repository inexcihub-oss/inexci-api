import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGatewayInvoices1761001100000 implements MigrationInterface {
  name = 'CreateGatewayInvoices1761001100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "gateway_invoices" (
         "id" uuid NOT NULL DEFAULT gen_random_uuid(),
         "gateway_provider" character varying(30) NOT NULL,
         "gateway_invoice_id" character varying(100) NOT NULL,
         "owner_id" uuid,
         "subscription_id" uuid,
         "gateway_customer_id" character varying(100),
         "gateway_subscription_id" character varying(100),
         "status" character varying(20) NOT NULL,
         "amount_due_cents" integer NOT NULL DEFAULT 0,
         "amount_paid_cents" integer NOT NULL DEFAULT 0,
         "amount_discount_cents" integer NOT NULL DEFAULT 0,
         "currency" character varying(3) NOT NULL,
         "period_start" TIMESTAMP WITH TIME ZONE,
         "period_end" TIMESTAMP WITH TIME ZONE,
         "due_date" TIMESTAMP WITH TIME ZONE,
         "paid_at" TIMESTAMP WITH TIME ZONE,
         "invoice_created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
         "hosted_invoice_url" text,
         "coupon_code" character varying(100),
         "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_gateway_invoices" PRIMARY KEY ("id"),
         CONSTRAINT "UQ_gateway_invoices_gateway_invoice_id" UNIQUE ("gateway_invoice_id")
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_gateway_invoices_owner_created"
         ON "gateway_invoices" ("owner_id", "invoice_created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_gateway_invoices_status_paid"
         ON "gateway_invoices" ("status", "paid_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "gateway_invoices"`);
  }
}
