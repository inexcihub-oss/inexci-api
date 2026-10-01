import { MigrationInterface, QueryRunner } from 'typeorm';
// Import relativo de propósito: as migrations rodam pelo CLI do TypeORM,
// carregadas por glob e fora do contexto do Nest.
import {
  PERFIL_SEM_REGISTRO,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

/**
 * Conselho profissional no perfil (`council`), para clínicas
 * multiprofissionais: psicologia, nutrição, enfermagem etc. passam a ter
 * agenda e prontuário próprios. Ver `PLANO-MIGRACAO-FEEGOW.md` (MIG-02).
 *
 * - `council` nasce com default `CRM`: todo perfil existente continua médico,
 *   sem backfill.
 * - `crm`/`crm_state` (número/UF no conselho) deixam de ser NOT NULL: quem não
 *   é CRM pode não ter número cadastrado. Para CRM a obrigatoriedade continua,
 *   garantida no DTO e no service.
 *
 * O `up` só acrescenta e afrouxa; não há dado legado que o viole.
 */
export class AddCouncilToDoctorProfiles1755800200000 implements MigrationInterface {
  name = 'AddCouncilToDoctorProfiles1755800200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "doctor_profiles"
         ADD COLUMN "council" character varying(10) NOT NULL DEFAULT 'CRM'`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_profiles"
         ALTER COLUMN "crm" DROP NOT NULL,
         ALTER COLUMN "crm_state" DROP NOT NULL`,
    );
  }

  /** Reverter aperta o schema: aborta listando quem está sem número/UF. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const conflitos = await verificar(PERFIL_SEM_REGISTRO, (sql) =>
      queryRunner.query(sql),
    );
    if (conflitos.length > 0) {
      throw new Error(montarDiagnostico(PERFIL_SEM_REGISTRO, conflitos));
    }

    await queryRunner.query(
      `ALTER TABLE "doctor_profiles"
         ALTER COLUMN "crm" SET NOT NULL,
         ALTER COLUMN "crm_state" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "doctor_profiles" DROP COLUMN "council"`,
    );
  }
}
