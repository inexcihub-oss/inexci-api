import { MigrationInterface, QueryRunner } from 'typeorm';
// Import relativo de propósito: as migrations rodam pelo CLI do TypeORM,
// carregadas por glob e fora do contexto do Nest.
import {
  PACIENTE_SEM_CPF,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

/**
 * CPF do paciente passa a ser opcional.
 *
 * Pacientes vindos de outros sistemas (migração do Feegow, ver
 * `PLANO-MIGRACAO-FEEGOW.md`) frequentemente não têm CPF; estrangeiros e
 * menores também não. Quem preenche continua igual: a busca por CPF não muda e
 * a Solicitação Cirúrgica continua exigindo CPF para avançar
 * (`PendencyValidatorService.isPatientDataComplete`).
 *
 * O `up` só afrouxa, então não há dado legado que o viole.
 */
export class MakePatientCpfNullable1755800000000 implements MigrationInterface {
  name = 'MakePatientCpfNullable1755800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "patients" ALTER COLUMN "cpf" DROP NOT NULL`,
    );
  }

  /**
   * Reverter aperta o schema: aborta com a lista de pacientes sem CPF em vez
   * de inventar um valor (CPF falso seria pior que a falta dele).
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const conflitos = await verificar(PACIENTE_SEM_CPF, (sql) =>
      queryRunner.query(sql),
    );
    if (conflitos.length > 0) {
      throw new Error(montarDiagnostico(PACIENTE_SEM_CPF, conflitos));
    }

    await queryRunner.query(
      `ALTER TABLE "patients" ALTER COLUMN "cpf" SET NOT NULL`,
    );
  }
}
