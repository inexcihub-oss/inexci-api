import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  HOSPITAL_OU_CONVENIO_COM_NOME_REPETIDO,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

export const UQ_HOSPITALS_OWNER_NAME = 'uq_hospitals_owner_name_active';
export const UQ_HEALTH_PLANS_OWNER_NAME = 'uq_health_plans_owner_name_active';

export class AddUniqueHospitalAndHealthPlanName1755801700000 implements MigrationInterface {
  name = 'AddUniqueHospitalAndHealthPlanName1755801700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const conflitos = await verificar(
      HOSPITAL_OU_CONVENIO_COM_NOME_REPETIDO,
      (sql) => queryRunner.query(sql),
    );
    if (conflitos.length > 0) {
      throw new Error(
        montarDiagnostico(HOSPITAL_OU_CONVENIO_COM_NOME_REPETIDO, conflitos),
      );
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX "${UQ_HOSPITALS_OWNER_NAME}" ON "hospitals" ("owner_id", lower("name")) WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "${UQ_HEALTH_PLANS_OWNER_NAME}" ON "health_plans" ("owner_id", lower("name")) WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "${UQ_HEALTH_PLANS_OWNER_NAME}"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "${UQ_HOSPITALS_OWNER_NAME}"`,
    );
  }
}
