import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adiciona o valor 'pdf_generated' ao enum activity_type_enum.
 * Esse valor é usado para registrar a geração automática do PDF
 * da solicitação cirúrgica no histórico de atividades.
 */
export class AddPdfGeneratedActivityType1743800000000 implements MigrationInterface {
  name = 'AddPdfGeneratedActivityType1743800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL permite adicionar valores ao enum sem recriar o tipo
    await queryRunner.query(`
      ALTER TYPE "activity_type_enum" ADD VALUE IF NOT EXISTS 'pdf_generated';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL não suporta remoção de valores de enum diretamente.
    // Para reverter, seria necessário recriar o tipo — omitido por segurança.
  }
}
