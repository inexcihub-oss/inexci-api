import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  TABELA_DE_CAIXA,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

export class CreateCashSessions1760900100000 implements MigrationInterface {
  name = 'CreateCashSessions1760900100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const conflitos = await verificar(TABELA_DE_CAIXA, (sql) =>
      queryRunner.query(sql),
    );
    if (conflitos.length > 0) {
      throw new Error(montarDiagnostico(TABELA_DE_CAIXA, conflitos));
    }

    await queryRunner.query(`
      CREATE TABLE "cash_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "account_id" uuid NOT NULL,
        "opened_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "closed_at" TIMESTAMP WITH TIME ZONE,
        "opening_amount" numeric(12,2) NOT NULL DEFAULT 0,
        "counted_amount" numeric(12,2),
        "expected_amount" numeric(12,2),
        "difference" numeric(12,2),
        "notes" text,
        "closed_by_id" uuid,
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cash_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cash_sessions_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_cash_sessions_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_cash_sessions_account"
          FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_cash_sessions_closed_by"
          FOREIGN KEY ("closed_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_cash_sessions_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_cash_sessions_user_open" ON "cash_sessions" ("user_id") WHERE "closed_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cash_sessions_owner_opened_at" ON "cash_sessions" ("owner_id", "opened_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cash_sessions_user_id" ON "cash_sessions" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_cash_sessions_account_id" ON "cash_sessions" ("account_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "cash_sessions"`);
  }
}
