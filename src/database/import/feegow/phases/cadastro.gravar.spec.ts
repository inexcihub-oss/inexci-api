import { EntityManager } from 'typeorm';
import { Clinic } from 'src/database/entities/clinic.entity';
import { DoctorProfile } from 'src/database/entities/doctor-profile.entity';
import { HealthPlan } from 'src/database/entities/health-plan.entity';
import { Patient } from 'src/database/entities/patient.entity';
import { User } from 'src/database/entities/user.entity';
import { UserDoctorAccess } from 'src/database/entities/user-doctor-access.entity';
import { contextoDeTeste, exportSintetico } from '../testing/export-sintetico';
import { gravarCadastro, planejarCadastro } from './cadastro.phase';

/** EntityManager falso que registra cada INSERT (entidade, linhas, orIgnore). */
function managerQueRegistra() {
  const inserts: { entidade: unknown; linhas: unknown[]; orIgnore: boolean }[] =
    [];
  const manager = {
    createQueryBuilder: () => {
      const registro = {
        entidade: null as unknown,
        linhas: [] as unknown[],
        orIgnore: false,
      };
      const qb = {
        insert: () => qb,
        into: (e: unknown) => ((registro.entidade = e), qb),
        values: (v: unknown[]) => ((registro.linhas = v), qb),
        orIgnore: () => ((registro.orIgnore = true), qb),
        execute: async () => {
          inserts.push(registro);
        },
      };
      return qb;
    },
  } as unknown as EntityManager;
  return { manager, inserts };
}

describe('gravarCadastro', () => {
  it('insere na ordem das chaves estrangeiras', async () => {
    const plano = planejarCadastro(exportSintetico(), contextoDeTeste());
    const { manager, inserts } = managerQueRegistra();

    await gravarCadastro(plano, manager);

    expect(inserts.map((i) => i.entidade)).toEqual([
      Clinic,
      User,
      DoctorProfile,
      UserDoctorAccess,
      HealthPlan,
      Patient,
    ]);
  });

  it('ignora vínculo que já existe (usuário casado com um existente)', async () => {
    const plano = planejarCadastro(exportSintetico(), contextoDeTeste());
    const { manager, inserts } = managerQueRegistra();

    await gravarCadastro(plano, manager);

    const porEntidade = new Map(inserts.map((i) => [i.entidade, i.orIgnore]));
    expect(porEntidade.get(UserDoctorAccess)).toBe(true);
    expect(porEntidade.get(Patient)).toBe(false);
  });

  it('grava os pacientes com created_at histórico', async () => {
    const plano = planejarCadastro(exportSintetico(), contextoDeTeste());
    const { manager, inserts } = managerQueRegistra();

    await gravarCadastro(plano, manager);

    const pacientes = inserts.find((i) => i.entidade === Patient)!.linhas as {
      createdAt: Date;
    }[];
    expect(pacientes[0].createdAt.toISOString()).toBe(
      '2023-01-12T03:00:00.000Z',
    );
  });

  it('divide em lotes de 200', async () => {
    const plano = planejarCadastro(exportSintetico(), contextoDeTeste());
    plano.pacientes = Array.from({ length: 450 }, (_, i) => ({
      ...plano.pacientes[0],
      id: `p-${i}`,
    }));
    const { manager, inserts } = managerQueRegistra();

    await gravarCadastro(plano, manager);

    expect(
      inserts.filter((i) => i.entidade === Patient).map((i) => i.linhas.length),
    ).toEqual([200, 200, 50]);
  });

  it('não insere a clínica quando ela já foi importada', async () => {
    const plano = planejarCadastro(exportSintetico(), contextoDeTeste());
    plano.clinica = null;
    const { manager, inserts } = managerQueRegistra();

    await gravarCadastro(plano, manager);

    expect(inserts.map((i) => i.entidade)).not.toContain(Clinic);
  });
});
