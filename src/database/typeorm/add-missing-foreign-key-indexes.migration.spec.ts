import { QueryRunner, getMetadataArgsStorage } from 'typeorm';
import { AddMissingForeignKeyIndexes1755800800000 } from './migrations/1755800800000-AddMissingForeignKeyIndexes';
import { ClinicRoom } from '../entities/clinic-room.entity';
import { ClinicalDocumentTemplate } from '../entities/clinical-document-template.entity';
import { DoctorSchedule } from '../entities/doctor-schedule.entity';
import { ScheduleBlock } from '../entities/schedule-block.entity';
import { Holiday } from '../entities/holiday.entity';

/**
 * A migration cria os índices que faltavam nas FKs `ON DELETE SET NULL` e dá
 * nome explícito às FKs/CHECKs que o Postgres batizou sozinho. O nome importa
 * porque o TypeORM compara constraint por nome: se a entidade declarar outro,
 * `migration:generate` derruba e recria tudo.
 */
describe('AddMissingForeignKeyIndexes1755800800000', () => {
  const RE_LOOKUP = /FROM "pg_constraint"/;

  /**
   * Simula o catálogo: `nomes` mapeia "tabela.coluna.tipo" para o nome atual
   * da constraint. Ausente = constraint não encontrada.
   */
  function criarQueryRunner(nomeAtual: (chave: string) => string | undefined) {
    const query = jest.fn((sql: string, params?: string[]) => {
      if (RE_LOOKUP.test(sql) && params) {
        const [tabelaQuoted, tipo, coluna] = params;
        const tabela = tabelaQuoted.replace(/"/g, '');
        const nome = nomeAtual(`${tabela}.${coluna}.${tipo}`);
        return Promise.resolve(nome ? [{ nome }] : []);
      }
      return Promise.resolve(undefined);
    });
    return { queryRunner: { query } as unknown as QueryRunner, query };
  }

  const automatico = (chave: string) => {
    const [tabela, coluna, tipo] = chave.split('.');
    return `${tabela}_${coluna}_${tipo === 'f' ? 'fkey' : 'check'}`;
  };

  const executadas = (query: jest.Mock) =>
    query.mock.calls
      .map(([sql]) => sql as string)
      .filter((sql) => !RE_LOOKUP.test(sql));

  const renomeadasPara = (query: jest.Mock) =>
    executadas(query)
      .map((sql) => /RENAME CONSTRAINT "[^"]+" TO "([^"]+)"/.exec(sql)?.[1])
      .filter((nome): nome is string => !!nome);

  it('up cria os três índices de FK com IF NOT EXISTS', async () => {
    const { queryRunner, query } = criarQueryRunner(automatico);

    await new AddMissingForeignKeyIndexes1755800800000().up(queryRunner);

    const sql = executadas(query).join('\n');
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "idx_appointments_health_plan_id" ON "appointments" \("health_plan_id"\)/,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "idx_appointments_created_by_id" ON "appointments" \("created_by_id"\)/,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "idx_schedule_blocks_created_by_id" ON "schedule_blocks" \("created_by_id"\)/,
    );
  });

  it('up renomeia as constraints automáticas e não aperta o schema', async () => {
    const { queryRunner, query } = criarQueryRunner(automatico);

    await new AddMissingForeignKeyIndexes1755800800000().up(queryRunner);

    const sql = executadas(query).join('\n');
    expect(sql).toMatch(
      /ALTER TABLE "schedule_blocks" RENAME CONSTRAINT "schedule_blocks_created_by_id_fkey" TO "FK_schedule_blocks_created_by"/,
    );
    expect(sql).toMatch(
      /RENAME CONSTRAINT "doctor_schedules_weekday_check" TO "CHK_doctor_schedules_weekday"/,
    );
    expect(sql).not.toMatch(/ADD\s+CONSTRAINT|SET\s+NOT\s+NULL|UNIQUE/i);
  });

  it('up não renomeia o que já tem o nome final (reexecução)', async () => {
    // Primeira passada só para descobrir os nomes finais.
    const primeira = criarQueryRunner(automatico);
    await new AddMissingForeignKeyIndexes1755800800000().up(
      primeira.queryRunner,
    );
    const finais = renomeadasPara(primeira.query);
    const porChave = new Map<string, string>();
    primeira.query.mock.calls
      .filter(([sql]) => RE_LOOKUP.test(sql as string))
      .forEach(([, params], i) => {
        const [tabela, tipo, coluna] = params as string[];
        porChave.set(
          `${tabela.replace(/"/g, '')}.${coluna}.${tipo}`,
          finais[i],
        );
      });

    const { queryRunner, query } = criarQueryRunner((c) => porChave.get(c));
    await new AddMissingForeignKeyIndexes1755800800000().up(queryRunner);

    expect(renomeadasPara(query)).toEqual([]);
  });

  it('aborta se a constraint esperada não existir', async () => {
    const { queryRunner } = criarQueryRunner(() => undefined);

    await expect(
      new AddMissingForeignKeyIndexes1755800800000().up(queryRunner),
    ).rejects.toThrow(/Esperava 1 constraint/);
  });

  it('down devolve os nomes automáticos e derruba os índices', async () => {
    const subida = criarQueryRunner(automatico);
    await new AddMissingForeignKeyIndexes1755800800000().up(subida.queryRunner);
    const finais = new Set(renomeadasPara(subida.query));

    // Qualquer nome atual diferente do automático força a renomeação.
    const { queryRunner, query } = criarQueryRunner(() => 'FK_qualquer');

    await new AddMissingForeignKeyIndexes1755800800000().down(queryRunner);

    const destinos = renomeadasPara(query);
    expect(destinos).toContain('schedule_blocks_created_by_id_fkey');
    expect(destinos).toContain('doctor_schedules_slot_minutes_check');
    expect(destinos).toHaveLength(finais.size);
    const sql = executadas(query).join('\n');
    expect(sql).toMatch(
      /DROP INDEX IF EXISTS "idx_appointments_health_plan_id"/,
    );
    expect(sql).toMatch(
      /DROP INDEX IF EXISTS "idx_appointments_created_by_id"/,
    );
    expect(sql).toMatch(
      /DROP INDEX IF EXISTS "idx_schedule_blocks_created_by_id"/,
    );
  });

  /**
   * Guarda contra drift: todo nome que a migration grava no banco tem de
   * estar declarado na entidade (`foreignKeyConstraintName` ou `@Check`).
   */
  it('todo nome renomeado está declarado nas entidades', async () => {
    const { queryRunner, query } = criarQueryRunner(automatico);
    await new AddMissingForeignKeyIndexes1755800800000().up(queryRunner);

    const entidades: unknown[] = [
      ClinicRoom,
      ClinicalDocumentTemplate,
      DoctorSchedule,
      ScheduleBlock,
      Holiday,
    ];
    const storage = getMetadataArgsStorage();
    const declarados = new Set<string>([
      ...storage.joinColumns
        .filter((j) => entidades.includes(j.target))
        .map((j) => j.foreignKeyConstraintName)
        .filter((n): n is string => !!n),
      ...storage.checks
        .filter((c) => entidades.includes(c.target))
        .map((c) => c.name)
        .filter((n): n is string => !!n),
    ]);

    const naoDeclarados = renomeadasPara(query).filter(
      (nome) => !declarados.has(nome),
    );
    expect(naoDeclarados).toEqual([]);
  });

  it('as entidades declaram os índices e CHECKs criados pela 1755800700000', () => {
    const storage = getMetadataArgsStorage();
    const indices = storage.indices
      .filter((i) => i.target === ScheduleBlock)
      .map((i) => i.name);
    expect(indices).toEqual(
      expect.arrayContaining([
        'idx_schedule_blocks_doctor_range',
        'idx_schedule_blocks_owner_range',
        'idx_schedule_blocks_created_by_id',
      ]),
    );

    const checks = storage.checks
      .filter((c) => c.target === ScheduleBlock || c.target === DoctorSchedule)
      .map((c) => c.name);
    expect(checks).toEqual(
      expect.arrayContaining([
        'CHK_schedule_blocks_range',
        'CHK_doctor_schedules_time',
        'CHK_doctor_schedules_weekday',
        'CHK_doctor_schedules_slot_minutes',
      ]),
    );
  });
});
