import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  ORFAOS_ANTES_DA_CASCATA,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

export class FixUserDeletionReferentialActions1755700100000 implements MigrationInterface {
  name = 'FixUserDeletionReferentialActions1755700100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const orfaos = await verificar(ORFAOS_ANTES_DA_CASCATA, (sql) =>
      queryRunner.query(sql),
    );

    if (orfaos.length > 0) {
      throw new Error(montarDiagnostico(ORFAOS_ANTES_DA_CASCATA, orfaos));
    }

    await queryRunner.query(`
      ALTER TABLE "surgery_requests"
        DROP CONSTRAINT IF EXISTS "fk_surgery_requests_created_by",
        ADD CONSTRAINT "fk_surgery_requests_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE "surgery_requests"
        DROP CONSTRAINT IF EXISTS "fk_surgery_requests_hospital",
        ADD CONSTRAINT "fk_surgery_requests_hospital"
          FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE "surgery_requests"
        DROP CONSTRAINT IF EXISTS "fk_surgery_requests_health_plan",
        ADD CONSTRAINT "fk_surgery_requests_health_plan"
          FOREIGN KEY ("health_plan_id") REFERENCES "health_plans"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE "patients"
        DROP CONSTRAINT IF EXISTS "fk_patients_health_plan",
        ADD CONSTRAINT "fk_patients_health_plan"
          FOREIGN KEY ("health_plan_id") REFERENCES "health_plans"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE "surgery_request_quotations"
        DROP CONSTRAINT IF EXISTS "fk_quotations_supplier",
        ADD CONSTRAINT "fk_quotations_supplier"
          FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "surgery_request_quotations"
        DROP CONSTRAINT IF EXISTS "fk_quotations_supplier",
        ADD CONSTRAINT "fk_quotations_supplier"
          FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE "patients"
        DROP CONSTRAINT IF EXISTS "fk_patients_health_plan",
        ADD CONSTRAINT "fk_patients_health_plan"
          FOREIGN KEY ("health_plan_id") REFERENCES "health_plans"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE "surgery_requests"
        DROP CONSTRAINT IF EXISTS "fk_surgery_requests_health_plan",
        ADD CONSTRAINT "fk_surgery_requests_health_plan"
          FOREIGN KEY ("health_plan_id") REFERENCES "health_plans"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE "surgery_requests"
        DROP CONSTRAINT IF EXISTS "fk_surgery_requests_hospital",
        ADD CONSTRAINT "fk_surgery_requests_hospital"
          FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      ALTER TABLE "surgery_requests"
        DROP CONSTRAINT IF EXISTS "fk_surgery_requests_created_by",
        ADD CONSTRAINT "fk_surgery_requests_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
    `);
  }
}
