import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pacientes: CPF obrigatório; telefone e e-mail opcionais.
 */
export class RequireCpfAndMakeContactOptionalInPatients1781820000000 implements MigrationInterface {
  name = 'RequireCpfAndMakeContactOptionalInPatients1781820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "patients" ALTER COLUMN "phone" DROP NOT NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ALTER COLUMN "email" DROP NOT NULL;`,
    );

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM "patients"
          WHERE "cpf" IS NULL OR btrim("cpf") = ''
        ) THEN
          RAISE EXCEPTION 'Não foi possível tornar cpf obrigatório: existem pacientes sem CPF preenchido.';
        END IF;
      END
      $$;
    `);

    await queryRunner.query(
      `ALTER TABLE "patients" ALTER COLUMN "cpf" SET NOT NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "patients" ALTER COLUMN "cpf" DROP NOT NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ALTER COLUMN "email" SET NOT NULL;`,
    );
    await queryRunner.query(
      `ALTER TABLE "patients" ALTER COLUMN "phone" SET NOT NULL;`,
    );
  }
}
