import { MigrationInterface, QueryRunner } from 'typeorm';
// Import relativo de propósito: as migrations rodam pelo CLI do TypeORM,
// carregadas por glob e fora do contexto do Nest.
import {
  FOTO_DE_PACIENTE_REPETIDA,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

/**
 * Um caminho de foto (`photo_path`) em no máximo um paciente, no banco.
 *
 * O `PatientsService` já recusa foto de outro paciente (`fotoEmUso`), mas é
 * check-then-write: duas trocas simultâneas com o mesmo caminho passam pela
 * checagem antes de qualquer uma gravar. O índice fecha a corrida; o
 * pré-check continua para a resposta amigável, e o service traduz o `23505`
 * na mesma 400. Inclui excluídos (soft delete), como o `fotoEmUso`: paciente
 * restaurado não pode voltar sem foto. Nome igual ao `@Index` da entidade.
 */
export class AddUniquePatientPhotoPath1755801100000 implements MigrationInterface {
  name = 'AddUniquePatientPhotoPath1755801100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const conflitos = await verificar(FOTO_DE_PACIENTE_REPETIDA, (sql) =>
      queryRunner.query(sql),
    );
    if (conflitos.length > 0) {
      throw new Error(montarDiagnostico(FOTO_DE_PACIENTE_REPETIDA, conflitos));
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_patients_photo_path" ON "patients" ("photo_path") WHERE photo_path IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_patients_photo_path"`);
  }
}
