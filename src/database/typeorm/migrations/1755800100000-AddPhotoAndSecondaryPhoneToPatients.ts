import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Foto e segundo telefone do paciente — ambos opcionais.
 *
 * `photo_path` guarda o caminho interno no R2 (`patient-photos/<ownerId>/...`),
 * nunca uma URL: a URL assinada é gerada na leitura. `secondary_phone` cobre o
 * telefone fixo/recado que muita clínica registra além do celular.
 *
 * Colunas novas e anuláveis: nenhuma linha existente passa a violar nada.
 */
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
