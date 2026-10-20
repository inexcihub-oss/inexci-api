import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPhotoAndSecondaryPhoneToPatients1755800100000 implements MigrationInterface {
  name = 'AddPhotoAndSecondaryPhoneToPatients1755800100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "patients"
         ADD COLUMN "photo_path" character varying(255),
         ADD COLUMN "secondary_phone" character varying(15)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "patients"
         DROP COLUMN "secondary_phone",
         DROP COLUMN "photo_path"`,
    );
  }
}
