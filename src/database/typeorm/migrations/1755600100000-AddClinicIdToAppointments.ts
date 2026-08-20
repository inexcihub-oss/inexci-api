import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vincula a consulta ao local de atendimento. Coluna **nullable**: consultas
 * já marcadas continuam válidas sem clínica e nenhuma linha precisa ser
 * migrada.
 *
 * A FK é declarada em nível de coluna, no próprio `ADD COLUMN`, porque a
 * coluna nasce nesta mesma migration — não há linha existente que a FK possa
 * rejeitar.
 *
 * `ON DELETE SET NULL` é rede de segurança: a exclusão de clínica é soft, então
 * na prática a linha nunca some e o vínculo histórico é preservado.
 */
export class AddClinicIdToAppointments1755600100000 implements MigrationInterface {
  name = 'AddClinicIdToAppointments1755600100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD COLUMN "clinic_id" uuid ` +
        `REFERENCES "clinics"("id") ON DELETE SET NULL;`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_appointments_clinic_id" ON "appointments" ("clinic_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_appointments_clinic_id";`);
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP COLUMN "clinic_id";`,
    );
  }
}
