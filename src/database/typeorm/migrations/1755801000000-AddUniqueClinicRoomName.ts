import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  SALAS_COM_NOME_REPETIDO,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

export const UQ_CLINIC_ROOMS_CLINIC_NAME = 'uq_clinic_rooms_clinic_name_active';

export class AddUniqueClinicRoomName1755801000000 implements MigrationInterface {
  name = 'AddUniqueClinicRoomName1755801000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const conflitos = await verificar(SALAS_COM_NOME_REPETIDO, (sql) =>
      queryRunner.query(sql),
    );
    if (conflitos.length > 0) {
      throw new Error(montarDiagnostico(SALAS_COM_NOME_REPETIDO, conflitos));
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX "${UQ_CLINIC_ROOMS_CLINIC_NAME}" ON "clinic_rooms" ("clinic_id", lower(btrim("name"))) WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "${UQ_CLINIC_ROOMS_CLINIC_NAME}"`,
    );
  }
}
