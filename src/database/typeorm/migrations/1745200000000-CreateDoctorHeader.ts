import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDoctorHeader1745200000000 implements MigrationInterface {
  name = 'CreateDoctorHeader1745200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "public"."doctor_header_logo_position_enum" AS ENUM('left', 'right');
    `);

    await queryRunner.query(`
      CREATE TABLE "doctor_header" (
        "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
        "doctor_profile_id" UUID NOT NULL,
        "logo_url"          VARCHAR(500),
        "logo_position"     "public"."doctor_header_logo_position_enum" NOT NULL DEFAULT 'left',
        "content_html"      TEXT,
        "created_at"        TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_doctor_header" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_doctor_header_profile" UNIQUE ("doctor_profile_id"),
        CONSTRAINT "FK_doctor_header_profile"
          FOREIGN KEY ("doctor_profile_id")
          REFERENCES "doctor_profile"("id")
          ON DELETE CASCADE
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "doctor_header";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."doctor_header_logo_position_enum";`);
  }
}
