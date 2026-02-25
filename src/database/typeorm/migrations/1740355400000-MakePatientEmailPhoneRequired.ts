import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakePatientEmailPhoneRequired1740355400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Garante que nenhuma linha existente tenha NULL antes de adicionar NOT NULL
    await queryRunner.query(`
      UPDATE patient SET email = 'sem-email@inexci.com' WHERE email IS NULL OR email = ''
    `);
    await queryRunner.query(`
      UPDATE patient SET phone = '00000000000' WHERE phone IS NULL OR phone = ''
    `);

    await queryRunner.query(`
      ALTER TABLE patient ALTER COLUMN email SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE patient ALTER COLUMN phone SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE patient ALTER COLUMN email DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE patient ALTER COLUMN phone DROP NOT NULL
    `);
  }
}
