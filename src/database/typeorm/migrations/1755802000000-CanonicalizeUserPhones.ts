import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  TELEFONE_REPETIDO_APOS_CANONIZAR,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';
import {
  TELEFONE_BR_CANONICO_SQL,
  telefoneCanonicoSql,
} from '../../../shared/utils/phone.util';

export const IDX_USERS_PHONE_UNIQUE = 'IDX_users_phone_unique';

export const SQL_CANONIZA_TELEFONES = `UPDATE "users"
          SET "phone" = ${telefoneCanonicoSql('"phone"')}
        WHERE "phone" IS NOT NULL
          AND "deleted_at" IS NULL
          AND ${telefoneCanonicoSql('"phone"')} ~ '${TELEFONE_BR_CANONICO_SQL}'
          AND "phone" <> ${telefoneCanonicoSql('"phone"')}`;

export const SQL_INDICE_CANONICO = `CREATE UNIQUE INDEX "${IDX_USERS_PHONE_UNIQUE}" ON "users" ((${telefoneCanonicoSql('"phone"')})) WHERE "phone" IS NOT NULL AND "deleted_at" IS NULL`;

export const SQL_INDICE_ANTERIOR = `CREATE UNIQUE INDEX IF NOT EXISTS "${IDX_USERS_PHONE_UNIQUE}" ON "users" ("phone") WHERE "phone" IS NOT NULL AND "deleted_at" IS NULL`;

export class CanonicalizeUserPhones1755802000000 implements MigrationInterface {
  name = 'CanonicalizeUserPhones1755802000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const conflitos = await verificar(TELEFONE_REPETIDO_APOS_CANONIZAR, (sql) =>
      queryRunner.query(sql),
    );
    if (conflitos.length > 0) {
      throw new Error(
        montarDiagnostico(TELEFONE_REPETIDO_APOS_CANONIZAR, conflitos),
      );
    }

    await queryRunner.query(`DROP INDEX IF EXISTS "${IDX_USERS_PHONE_UNIQUE}"`);
    await queryRunner.query(SQL_CANONIZA_TELEFONES);
    await queryRunner.query(SQL_INDICE_CANONICO);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "${IDX_USERS_PHONE_UNIQUE}"`);
    await queryRunner.query(SQL_INDICE_ANTERIOR);
  }
}
