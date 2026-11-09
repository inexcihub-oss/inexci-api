import { DataSource } from 'typeorm';
import { ENTITIES } from '../entities';
import { ClinicalAccessVolumeRepository } from './clinical-access-volume.repository';

describe('ClinicalAccessVolumeRepository', () => {
  let repository: ClinicalAccessVolumeRepository;
  const consultas: Array<{ sql: string; params: unknown[] }> = [];
  let respostas: Array<{ trecho: string; records: unknown[] }> = [];
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({ type: 'postgres', entities: ENTITIES });
    await (
      dataSource as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
    const runner = {
      connection: dataSource,
      manager: dataSource.manager,
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(
        (sql: string, params: unknown[] = [], structured?: boolean) => {
          consultas.push({ sql, params });
          const records =
            respostas.find((r) => sql.includes(r.trecho))?.records ?? [];
          return Promise.resolve(
            structured ? { records, affected: 3 } : records,
          );
        },
      ),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValue(runner as never);
    jest
      .spyOn(dataSource.manager, 'query')
      .mockImplementation((sql: string, params?: unknown[]) => {
        consultas.push({ sql, params: params ?? [] });
        return Promise.resolve([{ count: 2 }]);
      });
    repository = new ClinicalAccessVolumeRepository(
      dataSource.getRepository('ClinicalAccessAudit') as never,
    );
  });

  beforeEach(() => {
    consultas.length = 0;
    respostas = [];
  });

  const ultima = () => consultas[consultas.length - 1];

  const filtro = {
    ownerId: 'o1',
    from: new Date('2026-10-01T03:00:00Z'),
    to: new Date('2026-10-28T03:00:00Z'),
  };

  const semPaciente = (sql: string) => {
    expect(sql).not.toContain('patient_id');
    expect(sql).not.toContain('resource_id');
    expect(sql).not.toContain('"ip"');
  };

  it('totals conta acessos e usuários da conta no período, sem tocar em paciente', async () => {
    respostas = [{ trecho: 'COUNT', records: [{ total: '40', users: '3' }] }];
    const totals = await repository.totals(filtro);
    const { sql, params } = ultima();
    expect(sql).toContain('"a"."owner_id" =');
    expect(params).toEqual(
      expect.arrayContaining(['o1', filtro.from, filtro.to]),
    );
    semPaciente(sql);
    expect(totals).toEqual({ total: 40, users: 3 });
  });

  it('byAction agrupa por recurso, ação e origem', async () => {
    respostas = [
      {
        trecho: 'GROUP BY',
        records: [
          {
            resource: 'clinical_record',
            action: 'read',
            origin: 'http',
            total: '9',
          },
        ],
      },
    ];
    const rows = await repository.byAction(filtro);
    semPaciente(ultima().sql);
    expect(rows).toEqual([
      { resource: 'clinical_record', action: 'read', origin: 'http', total: 9 },
    ]);
  });

  it('byUser agrupa por usuário e devolve só nome, ação e contagem', async () => {
    respostas = [
      {
        trecho: 'GROUP BY',
        records: [
          {
            userId: 'u1',
            userName: 'Ana',
            resource: 'patient',
            action: 'read',
            total: '4',
            lastAccessAt: new Date(),
          },
        ],
      },
    ];
    const rows = await repository.byUser(filtro);
    const { sql } = ultima();
    semPaciente(sql);
    expect(sql).toContain('"a"."actor_user_id"');
    expect(Object.keys(rows[0]).sort()).toEqual([
      'action',
      'lastAccessAt',
      'resource',
      'total',
      'userId',
      'userName',
    ]);
  });

  it('daily agrupa pelo dia de São Paulo', async () => {
    respostas = [
      { trecho: 'to_char', records: [{ day: '2026-10-27', total: '5' }] },
    ];
    const rows = await repository.daily(filtro);
    expect(ultima().sql).toContain("AT TIME ZONE 'America/Sao_Paulo'");
    expect(rows).toEqual([{ day: '2026-10-27', total: 5 }]);
  });

  it('byPatient agrupa por código anônimo do paciente, sem expor o id', async () => {
    respostas = [
      {
        trecho: 'md5',
        records: [
          {
            patientRef: 'a1b2c3d4e5',
            total: '7',
            users: '2',
            lastAccessAt: new Date(),
          },
        ],
      },
    ];
    const rows = await repository.byPatient(filtro, 50);
    const { sql } = ultima();
    expect(sql).toContain('left(md5(a.patient_id::text), 10)');
    expect(sql).not.toMatch(/"a"\."patient_id" AS/);
    expect(sql).not.toContain('resource_id');
    expect(sql).not.toContain('"ip"');
    expect(sql).toContain('LIMIT 50');
    expect(rows[0]).toEqual(
      expect.objectContaining({ patientRef: 'a1b2c3d4e5', total: 7, users: 2 }),
    );
    expect(Object.keys(rows[0]).sort()).toEqual([
      'lastAccessAt',
      'patientRef',
      'total',
      'users',
    ]);
  });

  it('patientEvents filtra pelo código do paciente dentro da conta e não devolve o id', async () => {
    respostas = [
      {
        trecho: 'md5',
        records: [
          {
            userId: 'u1',
            userName: 'Ana',
            resource: 'clinical_record',
            action: 'read',
            origin: 'http',
            createdAt: new Date(),
          },
        ],
      },
    ];
    const rows = await repository.patientEvents(filtro, 'a1b2c3d4e5', 200);
    const { sql, params } = ultima();
    expect(sql).toContain('"a"."owner_id" =');
    expect(sql).toContain('left(md5(a.patient_id::text), 10) =');
    expect(params).toEqual(expect.arrayContaining(['o1', 'a1b2c3d4e5']));
    expect(sql).not.toMatch(/"a"\."patient_id" AS/);
    expect(sql).not.toContain('resource_id');
    expect(sql).toContain('LIMIT 200');
    expect(Object.keys(rows[0]).sort()).toEqual([
      'action',
      'createdAt',
      'origin',
      'resource',
      'userId',
      'userName',
    ]);
  });
});
