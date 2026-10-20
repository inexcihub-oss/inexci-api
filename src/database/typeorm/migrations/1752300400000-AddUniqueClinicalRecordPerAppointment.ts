import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniqueClinicalRecordPerAppointment1752300400000 implements MigrationInterface {
  name = 'AddUniqueClinicalRecordPerAppointment1752300400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const duplicates: Array<{ appointment_id: string; total: string }> =
      await queryRunner.query(`
        SELECT appointment_id, COUNT(*) AS total
        FROM "clinical_records"
        WHERE appointment_id IS NOT NULL AND deleted_at IS NULL
        GROUP BY appointment_id
        HAVING COUNT(*) > 1;
      `);

    if (duplicates.length > 0) {
      const detail = duplicates
        .map((row) => `${row.appointment_id} (${row.total} fichas)`)
        .join(', ');
      throw new Error(
        'Existem consultas com mais de uma ficha de atendimento ativa. ' +
          'Resolva manualmente (mesclar o conteúdo e excluir a ficha ' +
          `redundante) antes de aplicar esta migration. Consultas: ${detail}`,
      );
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_clinical_records_appointment_unique" ON "clinical_records" ("appointment_id") WHERE appointment_id IS NOT NULL AND deleted_at IS NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "idx_clinical_records_appointment_unique";`,
    );
  }
}
