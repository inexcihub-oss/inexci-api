import { QueryRunner } from 'typeorm';
import { getMetadataArgsStorage } from 'typeorm';
import { AddUniquePatientPhotoPath1755801100000 } from './migrations/1755801100000-AddUniquePatientPhotoPath';
import {
  FOTO_DE_PACIENTE_REPETIDA,
  VERIFICACOES_PRE_MIGRATION,
} from './preflight/data-checks';
import { Patient } from '../entities/patient.entity';
import { UQ_PATIENTS_PHOTO_PATH } from '../../modules/patients/patients.service';

/**
 * O índice fecha a corrida do `fotoEmUso` (check-then-write). Dado legado com
 * a mesma foto em dois pacientes derrubaria o `CREATE UNIQUE INDEX` sem dizer
 * quais colidem — a migration confere antes, com a verificação do pré-flight.
 */
describe('AddUniquePatientPhotoPath1755801100000', () => {
  function criarQueryRunner(conflitos: Record<string, unknown>[] = []) {
    const query = jest.fn((sql: string) =>
      Promise.resolve(
        sql === FOTO_DE_PACIENTE_REPETIDA.sql ? conflitos : undefined,
      ),
    );
    return { queryRunner: { query } as unknown as QueryRunner, query };
  }
  const executadas = (query: jest.Mock) =>
    query.mock.calls.map(([sql]) => sql as string);

  it('verifica o dado e cria o índice único parcial', async () => {
    const { queryRunner, query } = criarQueryRunner();

    await new AddUniquePatientPhotoPath1755801100000().up(queryRunner);

    expect(executadas(query)).toEqual([
      FOTO_DE_PACIENTE_REPETIDA.sql,
      `CREATE UNIQUE INDEX "${UQ_PATIENTS_PHOTO_PATH}" ON "patients" ("photo_path") WHERE photo_path IS NOT NULL`,
    ]);
  });

  it('aborta com diagnóstico sem criar o índice quando há foto repetida', async () => {
    const { queryRunner, query } = criarQueryRunner([
      { photo_path: 'patient-photos/o/x.webp', ids: 'p-1, p-2' },
    ]);

    await expect(
      new AddUniquePatientPhotoPath1755801100000().up(queryRunner),
    ).rejects.toThrow(/p-1, p-2/);
    expect(executadas(query)).toEqual([FOTO_DE_PACIENTE_REPETIDA.sql]);
  });

  it('a verificação aponta para esta migration e roda no pré-flight', () => {
    expect(FOTO_DE_PACIENTE_REPETIDA.migration).toBe(
      new AddUniquePatientPhotoPath1755801100000().name,
    );
    expect(VERIFICACOES_PRE_MIGRATION).toContain(FOTO_DE_PACIENTE_REPETIDA);
  });

  it('a entidade declara o mesmo índice (senão o migration:generate o derruba)', () => {
    const indice = getMetadataArgsStorage().indices.find(
      (i) => i.target === Patient && i.name === UQ_PATIENTS_PHOTO_PATH,
    );
    expect(indice).toMatchObject({
      unique: true,
      where: 'photo_path IS NOT NULL',
    });
  });

  it('down derruba o índice', async () => {
    const { queryRunner, query } = criarQueryRunner();
    await new AddUniquePatientPhotoPath1755801100000().down(queryRunner);
    expect(executadas(query)).toEqual([
      `DROP INDEX IF EXISTS "${UQ_PATIENTS_PHOTO_PATH}"`,
    ]);
  });
});
