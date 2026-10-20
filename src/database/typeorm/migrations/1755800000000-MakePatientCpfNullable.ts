import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  PACIENTE_SEM_CPF,
  montarDiagnostico,
  verificar,
} from '../preflight/data-checks';

export class MakePatientCpfNullable1755800000000 implements MigrationInterface {
  name = 'MakePatientCpfNullable1755800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "patients" ALTER COLUMN "cpf" DROP NOT NULL`,
    );
  }

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
