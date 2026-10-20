import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  TELEFONE_DUPLICADO,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

export class AddUniqueIndexUserPhone1752300900000 implements MigrationInterface {
  name = 'AddUniqueIndexUserPhone1752300900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const conflitos = await verificar(TELEFONE_DUPLICADO, (sql) =>
      queryRunner.query(sql),
    );

    if (conflitos.length > 0) {
      throw new Error(montarDiagnostico(TELEFONE_DUPLICADO, conflitos));
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_phone_unique"
       ON "users" ("phone") WHERE "phone" IS NOT NULL AND "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_phone_unique"`);
  }
}
