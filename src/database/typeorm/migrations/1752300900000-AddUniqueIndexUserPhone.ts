import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniqueIndexUserPhone1752300900000
  implements MigrationInterface
{
  name = 'AddUniqueIndexUserPhone1752300900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Sem unicidade, dois usuarios com telefones colidentes compartilhavam a
    // mesma conversa de WhatsApp, o mesmo draft e a mesma memoria.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_phone_unique"
       ON "users" ("phone") WHERE "phone" IS NOT NULL AND "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_phone_unique"`);
  }
}
