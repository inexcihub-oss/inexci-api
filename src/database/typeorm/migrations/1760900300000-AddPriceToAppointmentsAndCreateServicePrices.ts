import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPriceToAppointmentsAndCreateServicePrices1760900300000 implements MigrationInterface {
  name = 'AddPriceToAppointmentsAndCreateServicePrices1760900300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "price" numeric(12,2)`,
    );

    await queryRunner.query(`
      CREATE TABLE "service_prices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" uuid NOT NULL,
        "doctor_id" uuid,
        "appointment_type" character varying(20),
        "description" character varying(150) NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_by_id" uuid,
        "updated_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_service_prices" PRIMARY KEY ("id"),
        CONSTRAINT "FK_service_prices_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_service_prices_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_service_prices_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_service_prices_updated_by"
          FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_service_prices_updated_by_id" ON "service_prices" ("updated_by_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_service_prices_owner_id" ON "service_prices" ("owner_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_service_prices_doctor_id" ON "service_prices" ("doctor_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "service_prices"`);
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP COLUMN IF EXISTS "price"`,
    );
  }
}
