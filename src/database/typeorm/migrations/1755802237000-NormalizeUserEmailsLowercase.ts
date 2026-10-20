import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  EMAIL_REPETIDO_SEM_MAIUSCULAS,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

export const UQ_USERS_EMAIL_LOWER = 'uq_users_email_lower';
export const UQ_USERS_EMAIL_ANTERIOR = 'uq_users_email';

export const SQL_NORMALIZA_EMAILS = `UPDATE "users"
          SET "email" = lower(btrim("email"))
        WHERE "email" <> lower(btrim("email"))`;

export const SQL_REMOVE_UNIQUE_ANTERIOR = `DO $$
DECLARE
  restricao record;
BEGIN
  FOR restricao IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = '"users"'::regclass
       AND c.contype = 'u'
       AND array_length(c.conkey, 1) = 1
       AND a.attname = 'email'
  LOOP
    EXECUTE format('ALTER TABLE "users" DROP CONSTRAINT %I', restricao.conname);
  END LOOP;
END $$`;

export const SQL_INDICE_EMAIL_LOWER = `CREATE UNIQUE INDEX IF NOT EXISTS "${UQ_USERS_EMAIL_LOWER}" ON "users" (lower("email"))`;

export class NormalizeUserEmailsLowercase1755802237000 implements MigrationInterface {
  name = 'NormalizeUserEmailsLowercase1755802237000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const conflitos = await verificar(EMAIL_REPETIDO_SEM_MAIUSCULAS, (sql) =>
      queryRunner.query(sql),
    );
    if (conflitos.length > 0) {
      throw new Error(
        montarDiagnostico(EMAIL_REPETIDO_SEM_MAIUSCULAS, conflitos),
      );
    }

    await queryRunner.query(SQL_NORMALIZA_EMAILS);
    await queryRunner.query(SQL_REMOVE_UNIQUE_ANTERIOR);
    await queryRunner.query(SQL_INDICE_EMAIL_LOWER);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "${UQ_USERS_EMAIL_LOWER}"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "${UQ_USERS_EMAIL_ANTERIOR}" UNIQUE ("email")`,
    );
  }
}
