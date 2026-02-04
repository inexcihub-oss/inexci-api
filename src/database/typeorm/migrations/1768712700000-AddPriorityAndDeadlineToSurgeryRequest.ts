import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPriorityAndDeadlineToSurgeryRequest1768712700000 implements MigrationInterface {
  name = 'AddPriorityAndDeadlineToSurgeryRequest1768712700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Verificar se a coluna priority já existe
    const priorityExists = await queryRunner.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='surgery_request' AND column_name='priority'
    `);

    if (priorityExists.length === 0) {
      // Adicionar coluna priority à tabela surgery_request
      await queryRunner.query(
        `ALTER TABLE "surgery_request" ADD "priority" character varying(20)`,
      );

      // Definir valor padrão "Média" para solicitações existentes
      await queryRunner.query(
        `UPDATE "surgery_request" SET "priority" = 'Média' WHERE "priority" IS NULL`,
      );
    }

    // Verificar se a coluna deadline já existe
    const deadlineExists = await queryRunner.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='surgery_request' AND column_name='deadline'
    `);

    if (deadlineExists.length === 0) {
      // Adicionar coluna deadline à tabela surgery_request
      await queryRunner.query(
        `ALTER TABLE "surgery_request" ADD "deadline" TIMESTAMP`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remover coluna deadline
    await queryRunner.query(
      `ALTER TABLE "surgery_request" DROP COLUMN "deadline"`,
    );

    // Remover coluna priority
    await queryRunner.query(
      `ALTER TABLE "surgery_request" DROP COLUMN "priority"`,
    );
  }
}
