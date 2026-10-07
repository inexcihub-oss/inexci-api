import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Procedimento escolhido (ou criado) pelo médico ao marcar "paciente
 * cirúrgico" no atendimento. Nasce nulo — o campo é opcional na ficha — e
 * viaja até a SC criada em Pendente (`SurgeryRequestFromIndicationService`),
 * para que o kanban já mostre o nome do procedimento em vez de nascer em
 * branco.
 *
 * `ADD CONSTRAINT` aqui é sobre `procedure_id`, coluna criada nesta mesma
 * migration — não há dado legado que possa violar a FK (toda linha existente
 * nasce com o campo NULL), então não precisa de entrada em
 * `preflight/data-checks.ts`.
 */
export class AddProcedureIdToClinicalRecords1755700400000 implements MigrationInterface {
  name = 'AddProcedureIdToClinicalRecords1755700400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "clinical_records" ADD COLUMN "procedure_id" uuid;`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinical_records" ADD CONSTRAINT "fk_clinical_records_procedure" FOREIGN KEY ("procedure_id") REFERENCES "procedures"("id") ON DELETE SET NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "clinical_records" DROP CONSTRAINT "fk_clinical_records_procedure";`,
    );
    await queryRunner.query(
      `ALTER TABLE "clinical_records" DROP COLUMN "procedure_id";`,
    );
  }
}
