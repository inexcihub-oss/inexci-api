import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  PERFIL_DE_OUTRO_CONSELHO,
  PERFIL_SEM_REGISTRO,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

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

  public async down(queryRunner: QueryRunner): Promise<void> {
    const diagnosticos: string[] = [];
    for (const verificacao of [PERFIL_SEM_REGISTRO, PERFIL_DE_OUTRO_CONSELHO]) {
      const conflitos = await verificar(verificacao, (sql) =>
        queryRunner.query(sql),
      );
      if (conflitos.length > 0) {
        diagnosticos.push(montarDiagnostico(verificacao, conflitos));
      }
    }
    if (diagnosticos.length > 0) {
      throw new Error(diagnosticos.join('\n\n'));
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
