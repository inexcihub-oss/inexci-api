import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  TABELAS_DA_FUNDACAO_FINANCEIRA,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

export class CreateFinancialAccountsAndPaymentMethodConfigs1760900000000 implements MigrationInterface {
  name = 'CreateFinancialAccountsAndPaymentMethodConfigs1760900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const conflitos = await verificar(TABELAS_DA_FUNDACAO_FINANCEIRA, (sql) =>
      queryRunner.query(sql),
    );
    if (conflitos.length > 0) {
      throw new Error(
        montarDiagnostico(TABELAS_DA_FUNDACAO_FINANCEIRA, conflitos),
      );
    }

    await queryRunner.query(`
      CREATE TABLE "financial_accounts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" uuid NOT NULL,
        "name" character varying(80) NOT NULL,
        "type" character varying(20) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "notes" text,
        "created_by_id" uuid,
        "updated_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_financial_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_financial_accounts_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_financial_accounts_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_financial_accounts_updated_by"
          FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_financial_accounts_updated_by_id" ON "financial_accounts" ("updated_by_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_financial_accounts_owner_id" ON "financial_accounts" ("owner_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_financial_accounts_created_by_id" ON "financial_accounts" ("created_by_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "payment_method_configs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" uuid NOT NULL,
        "method" character varying(20) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "default_account_id" uuid,
        "max_installments" integer NOT NULL DEFAULT 1,
        "created_by_id" uuid,
        "updated_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_method_configs" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_payment_method_configs_max_installments"
          CHECK ("max_installments" BETWEEN 1 AND 24),
        CONSTRAINT "FK_payment_method_configs_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_payment_method_configs_default_account"
          FOREIGN KEY ("default_account_id") REFERENCES "financial_accounts"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_payment_method_configs_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_payment_method_configs_updated_by"
          FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_payment_method_configs_updated_by_id" ON "payment_method_configs" ("updated_by_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_payment_method_configs_owner_method" ON "payment_method_configs" ("owner_id", "method")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payment_method_configs_default_account_id" ON "payment_method_configs" ("default_account_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_method_configs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "financial_accounts"`);
  }
}
