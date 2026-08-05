import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Garante no banco que cada consulta tenha no máximo uma ficha de atendimento
 * viva. O `ClinicalRecordsService` já rejeita a segunda ficha, mas duas abas
 * abertas (ou uma resposta HTTP perdida) podiam furar a checagem em nível de
 * aplicação e deixar um prontuário duplicado — sendo que `findByAppointment`
 * devolve apenas um deles, tornando o outro órfão e invisível na UI.
 *
 * Índice parcial: só vale para fichas vinculadas a consulta (`appointment_id`
 * não nulo) e não excluídas (`deleted_at` nulo), preservando o registro avulso
 * e o soft delete.
 */
export class AddUniqueClinicalRecordPerAppointment1752300400000 implements MigrationInterface {
  name = 'AddUniqueClinicalRecordPerAppointment1752300400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Um banco que já tenha duplicatas não pode criar o índice. Em vez de
    // deixar o Postgres falhar com erro opaco — ou pior, apagar dado clínico
    // automaticamente — abortamos apontando exatamente quais consultas
    // precisam de resolução manual.
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
