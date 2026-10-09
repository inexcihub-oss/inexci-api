import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  FOTO_DE_PACIENTE_REPETIDA,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

export class AddUniquePatientPhotoPath1755801100000 implements MigrationInterface {
  name = 'AddUniquePatientPhotoPath1755801100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const conflitos = await verificar(FOTO_DE_PACIENTE_REPETIDA, (sql) =>
      queryRunner.query(sql),
    );
    if (conflitos.length > 0) {
      throw new Error(montarDiagnostico(FOTO_DE_PACIENTE_REPETIDA, conflitos));
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_patients_photo_path" ON "patients" ("photo_path") WHERE photo_path IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_patients_photo_path"`);
  }
}
