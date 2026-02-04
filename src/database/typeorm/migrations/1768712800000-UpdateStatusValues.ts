import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateStatusValues1768712800000 implements MigrationInterface {
  name = 'UpdateStatusValues1768712800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Atualização dos status:
    // OLD STATUS:                  NEW STATUS:
    // 1 - Pendente           →     1 - Pendente
    // 2 - Enviada            →     2 - Enviada
    // 3 - Em Análise         →     3 - Em Análise
    // 4 - Em Reanálise       →     4 - Em Agendamento (mantém, só muda label)
    // 5 - Autorizada         →     4 - Em Agendamento (merge com 4)
    // 6 - Agendada           →     5 - Agendada
    // 7 - A Faturar          →     6 - Realizada
    // 8 - Faturada           →     7 - Faturada
    // 9 - Finalizada         →     8 - Finalizada
    // 10 - Cancelada         →     9 - Cancelada

    // A ordem de atualização é importante para evitar conflitos
    // Atualizar de maior para menor para status que diminuem

    // 10 → 9 (Cancelada)
    await queryRunner.query(`
      UPDATE surgery_request SET status = 9 WHERE status = 10
    `);

    // 9 → 8 (Finalizada)
    await queryRunner.query(`
      UPDATE surgery_request SET status = 8 WHERE status = 9 AND status != 9
    `);
    // Corrigindo: precisamos fazer em ordem reversa para evitar sobrescrever
    // Primeiro vamos usar valores temporários negativos

    // Resetar e fazer corretamente usando valores temporários
    await queryRunner.query(`
      UPDATE surgery_request SET status = -9 WHERE status = 9
    `);
    await queryRunner.query(`
      UPDATE surgery_request SET status = -8 WHERE status = 8
    `);
    await queryRunner.query(`
      UPDATE surgery_request SET status = -7 WHERE status = 7
    `);
    await queryRunner.query(`
      UPDATE surgery_request SET status = -6 WHERE status = 6
    `);
    await queryRunner.query(`
      UPDATE surgery_request SET status = -5 WHERE status = 5
    `);
    await queryRunner.query(`
      UPDATE surgery_request SET status = -4 WHERE status = 4
    `);

    // Agora converter os valores temporários para os novos valores
    await queryRunner.query(`
      UPDATE surgery_request SET status = 4 WHERE status = -4
    `);
    await queryRunner.query(`
      UPDATE surgery_request SET status = 4 WHERE status = -5
    `);
    await queryRunner.query(`
      UPDATE surgery_request SET status = 5 WHERE status = -6
    `);
    await queryRunner.query(`
      UPDATE surgery_request SET status = 6 WHERE status = -7
    `);
    await queryRunner.query(`
      UPDATE surgery_request SET status = 7 WHERE status = -8
    `);
    await queryRunner.query(`
      UPDATE surgery_request SET status = 8 WHERE status = -9
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverter as alterações de status
    // Usar valores temporários negativos

    await queryRunner.query(`
      UPDATE surgery_request SET status = -8 WHERE status = 8
    `);
    await queryRunner.query(`
      UPDATE surgery_request SET status = -7 WHERE status = 7
    `);
    await queryRunner.query(`
      UPDATE surgery_request SET status = -6 WHERE status = 6
    `);
    await queryRunner.query(`
      UPDATE surgery_request SET status = -5 WHERE status = 5
    `);
    await queryRunner.query(`
      UPDATE surgery_request SET status = -4 WHERE status = 4
    `);

    // Converter de volta (nota: não podemos distinguir 4 de 5 originais)
    await queryRunner.query(`
      UPDATE surgery_request SET status = 4 WHERE status = -4
    `);
    await queryRunner.query(`
      UPDATE surgery_request SET status = 6 WHERE status = -5
    `);
    await queryRunner.query(`
      UPDATE surgery_request SET status = 7 WHERE status = -6
    `);
    await queryRunner.query(`
      UPDATE surgery_request SET status = 8 WHERE status = -7
    `);
    await queryRunner.query(`
      UPDATE surgery_request SET status = 9 WHERE status = -8
    `);

    // 9 → 10 (Cancelada de volta)
    await queryRunner.query(`
      UPDATE surgery_request SET status = 10 WHERE status = 9
    `);
  }
}
