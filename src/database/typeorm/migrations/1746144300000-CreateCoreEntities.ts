import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cadastros básicos do domínio (entidades de negócio):
 * procedures, hospitals, health_plans, suppliers e patients.
 *
 * Cadastros (hospitals/health_plans/suppliers) usam `owner_id` para tenant
 * isolation; `patients` ganha `owner_id` denormalizado para acelerar
 * filtros por clínica.
 */
export class CreateCoreEntities1746144300000 implements MigrationInterface {
  name = 'CreateCoreEntities1746144300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "procedures" (
        "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
        "name"       VARCHAR(255) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_procedures" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "hospitals" (
        "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
        "name"           VARCHAR(150) NOT NULL,
        "cnpj"           VARCHAR(20),
        "email"          VARCHAR(100),
        "phone"          VARCHAR(15),
        "contact_name"   VARCHAR(100),
        "contact_phone"  VARCHAR(15),
        "contact_email"  VARCHAR(100),
        "zip_code"       VARCHAR(10),
        "address"        VARCHAR(200),
        "address_number" VARCHAR(20),
        "address_complement" VARCHAR(100),
        "neighborhood"   VARCHAR(100),
        "city"           VARCHAR(100),
        "state"          CHAR(2),
        "active"         BOOLEAN NOT NULL DEFAULT true,
        "owner_id"       UUID NOT NULL,
        "deleted_at"     TIMESTAMP,
        "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_hospitals" PRIMARY KEY ("id"),
        CONSTRAINT "fk_hospitals_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_hospitals_owner_id"   ON "hospitals" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_hospitals_deleted_at" ON "hospitals" ("deleted_at");`,
    );

    await queryRunner.query(`
      CREATE TABLE "health_plans" (
        "id"                    UUID NOT NULL DEFAULT gen_random_uuid(),
        "name"                  VARCHAR(150) NOT NULL,
        "ans_code"              VARCHAR(20),
        "cnpj"                  VARCHAR(20),
        "email"                 VARCHAR(100),
        "phone"                 VARCHAR(15),
        "zip_code"              VARCHAR(10),
        "address"               VARCHAR(200),
        "address_number"        VARCHAR(20),
        "address_complement"    VARCHAR(100),
        "city"                  VARCHAR(100),
        "state"                 CHAR(2),
        "authorization_contact" VARCHAR(100),
        "authorization_phone"   VARCHAR(15),
        "authorization_email"   VARCHAR(100),
        "website"               VARCHAR(255),
        "portal_url"            VARCHAR(255),
        "default_payment_days"  INTEGER,
        "notes"                 TEXT,
        "active"                BOOLEAN NOT NULL DEFAULT true,
        "owner_id"              UUID NOT NULL,
        "deleted_at"            TIMESTAMP,
        "created_at"            TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"            TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_health_plans" PRIMARY KEY ("id"),
        CONSTRAINT "fk_health_plans_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_health_plans_owner_id"   ON "health_plans" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_health_plans_deleted_at" ON "health_plans" ("deleted_at");`,
    );

    await queryRunner.query(`
      CREATE TABLE "suppliers" (
        "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
        "name"           VARCHAR(150) NOT NULL,
        "cnpj"           VARCHAR(20),
        "email"          VARCHAR(100),
        "phone"          VARCHAR(15),
        "contact_name"   VARCHAR(100),
        "contact_phone"  VARCHAR(15),
        "contact_email"  VARCHAR(100),
        "zip_code"       VARCHAR(10),
        "address"        VARCHAR(200),
        "address_number" VARCHAR(20),
        "address_complement" VARCHAR(100),
        "neighborhood"   VARCHAR(100),
        "city"           VARCHAR(100),
        "state"          CHAR(2),
        "website"        VARCHAR(200),
        "category"       VARCHAR(50),
        "payment_terms"  VARCHAR(50),
        "delivery_time"  VARCHAR(100),
        "notes"          TEXT,
        "owner_id"       UUID NOT NULL,
        "deleted_at"     TIMESTAMP,
        "created_at"     TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_suppliers" PRIMARY KEY ("id"),
        CONSTRAINT "fk_suppliers_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_suppliers_owner_id"   ON "suppliers" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_suppliers_deleted_at" ON "suppliers" ("deleted_at");`,
    );

    await queryRunner.query(`
      CREATE TABLE "patients" (
        "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
        "doctor_id"          UUID NOT NULL,
        "owner_id"           UUID NOT NULL,
        "name"               VARCHAR(100) NOT NULL,
        "email"              VARCHAR(100) NOT NULL,
        "phone"              VARCHAR(15) NOT NULL,
        "cpf"                VARCHAR(14),
        "gender"             CHAR(1),
        "birth_date"         DATE,
        "health_plan_id"     UUID,
        "health_plan_number" VARCHAR(50),
        "health_plan_type"   VARCHAR(100),
        "zip_code"           VARCHAR(10),
        "address"            VARCHAR(200),
        "address_number"     VARCHAR(20),
        "address_complement" VARCHAR(100),
        "neighborhood"       VARCHAR(100),
        "city"               VARCHAR(100),
        "state"              CHAR(2),
        "medical_notes"      TEXT,
        "active"             BOOLEAN NOT NULL DEFAULT true,
        "deleted_at"         TIMESTAMP,
        "created_at"         TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_patients" PRIMARY KEY ("id"),
        CONSTRAINT "fk_patients_doctor"
          FOREIGN KEY ("doctor_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_patients_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "fk_patients_health_plan"
          FOREIGN KEY ("health_plan_id") REFERENCES "health_plans"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_patients_doctor_id"  ON "patients" ("doctor_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_patients_owner_id"   ON "patients" ("owner_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_patients_deleted_at" ON "patients" ("deleted_at");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      'patients',
      'suppliers',
      'health_plans',
      'hospitals',
      'procedures',
    ];
    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE;`);
    }
  }
}
