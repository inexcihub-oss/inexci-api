import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  montarDiagnostico,
  TEXTO_RAPIDO_COM_ATALHO_REPETIDO,
  verificar,
} from '../preflight/data-checks';

export const UQ_CLINICAL_SNIPPETS_DOCTOR_SHORTCUT =
  'uq_clinical_snippets_doctor_shortcut_active';

export class AddUniqueClinicalSnippetShortcut1761000700000 implements MigrationInterface {
  name = 'AddUniqueClinicalSnippetShortcut1761000700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const conflitos = await verificar(TEXTO_RAPIDO_COM_ATALHO_REPETIDO, (sql) =>
      queryRunner.query(sql),
    );
    if (conflitos.length > 0) {
      throw new Error(
        montarDiagnostico(TEXTO_RAPIDO_COM_ATALHO_REPETIDO, conflitos),
      );
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX "${UQ_CLINICAL_SNIPPETS_DOCTOR_SHORTCUT}" ON "clinical_snippets" ("doctor_id", "shortcut") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "${UQ_CLINICAL_SNIPPETS_DOCTOR_SHORTCUT}"`,
    );
  }
}
