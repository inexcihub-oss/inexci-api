import { ProfessionalCouncil } from 'src/database/entities/doctor-profile.entity';
import { UserStatus } from 'src/database/entities/user.entity';
import { Permission } from 'src/shared/permissions/permission.enum';
import { horarioDaClinica } from '../mappers/clinic.mapper';
import { LEDGER_PACIENTE } from '../mappers/patient.mapper';
import { LEDGER_PROFISSIONAL } from '../mappers/team.mapper';
import {
  contextoDeTeste,
  exportSintetico,
  OWNER,
} from '../testing/export-sintetico';
import { planejarCadastro } from './cadastro.phase';

describe('planejarCadastro (export sintético)', () => {
  const donoExistente = () =>
    new Map([
      [
        'dono@exemplo.com',
        {
          id: OWNER,
          ownerId: OWNER,
          email: 'dono@exemplo.com',
          temPerfil: true,
        },
      ],
    ]);

  describe('equipe', () => {
    it('casa o dono pelo e-mail em vez de criar outro usuário', () => {
      const ctx = contextoDeTeste({ usuariosPorEmail: donoExistente() });
      const plano = planejarCadastro(exportSintetico(), ctx);

      expect(plano.equipe.usuarios.map((u) => u.email)).not.toContain(
        'dono@exemplo.com',
      );
      expect(ctx.ledger.resolver(LEDGER_PROFISSIONAL, '1')).toBe(OWNER);
    });

    it('cria nutricionista com conselho CRN e técnica sem conselho como OUTRO', () => {
      const ctx = contextoDeTeste({ usuariosPorEmail: donoExistente() });
      const { equipe } = planejarCadastro(exportSintetico(), ctx);

      const conselhos = equipe.perfis.map((p) => [
        p.council,
        p.crm,
        p.specialty,
      ]);
      expect(conselhos).toEqual([
        [ProfessionalCouncil.CRN, null, 'Nutrição'],
        [ProfessionalCouncil.OUTRO, null, null],
      ]);
      expect(ctx.relatorio.avisos.some((a) => a.aviso.includes('OUTRO'))).toBe(
        true,
      );
    });

    it('colaborador novo nasce pendente, sem senha e da conta do dono', () => {
      const { equipe } = planejarCadastro(exportSintetico(), contextoDeTeste());

      for (const u of equipe.usuarios) {
        expect(u).toMatchObject({
          status: UserStatus.PENDING,
          password: null,
          ownerId: OWNER,
          adminId: OWNER,
        });
      }
    });

    it('quem gere usuários no Feegow ganha Administração', () => {
      const { equipe } = planejarCadastro(exportSintetico(), contextoDeTeste());

      expect(
        equipe.usuarios.find((u) => u.email === 'carla@exemplo.com')
          ?.permissions,
      ).toEqual([Permission.AGENDA, Permission.ADMINISTRACAO]);
    });

    it('rejeita funcionário sem e-mail', () => {
      const ctx = contextoDeTeste();
      planejarCadastro(exportSintetico(), ctx);

      expect(ctx.relatorio.rejeicoes).toContainEqual(
        expect.objectContaining({ entidade: 'funcionário', idOrigem: '1' }),
      );
    });

    it('rejeita e-mail que já é de outra conta', () => {
      const ctx = contextoDeTeste({
        usuariosPorEmail: new Map([
          [
            'ana@exemplo.com',
            {
              id: 'x',
              ownerId: 'outra-conta',
              email: 'ana@exemplo.com',
              temPerfil: true,
            },
          ],
        ]),
      });
      planejarCadastro(exportSintetico(), ctx);

      expect(ctx.relatorio.rejeicoes).toContainEqual(
        expect.objectContaining({
          idOrigem: '4',
          motivo: expect.stringContaining('outra conta'),
        }),
      );
    });

    it('rejeita celular já usado por outro usuário', () => {
      const ctx = contextoDeTeste({ telefonesEmUso: new Set(['24999990004']) });
      planejarCadastro(exportSintetico(), ctx);

      expect(ctx.relatorio.rejeicoes).toContainEqual(
        expect.objectContaining({
          idOrigem: '4',
          motivo: expect.stringContaining('celular'),
        }),
      );
    });

    it('--mapear casa com o usuário existente informado', () => {
      const ctx = contextoDeTeste({
        usuariosPorEmail: new Map([
          [
            'outro@exemplo.com',
            {
              id: 'u-ana',
              ownerId: OWNER,
              email: 'outro@exemplo.com',
              temPerfil: true,
            },
          ],
        ]),
        mapear: new Map([['prof:4', 'outro@exemplo.com']]),
      });
      planejarCadastro(exportSintetico(), ctx);

      expect(ctx.ledger.resolver(LEDGER_PROFISSIONAL, '4')).toBe('u-ana');
    });

    it('vincula todo colaborador a todo profissional, inclusive o dono', () => {
      const ctx = contextoDeTeste({ usuariosPorEmail: donoExistente() });
      const { equipe } = planejarCadastro(exportSintetico(), ctx);
      const carla = equipe.usuarios.find(
        (u) => u.email === 'carla@exemplo.com',
      )!;

      const daCarla = equipe.acessos
        .filter((a) => a.userId === carla.id)
        .map((a) => a.doctorUserId);
      expect(daCarla).toContain(OWNER);
      expect(daCarla).toHaveLength(3);
      expect(equipe.acessos.every((a) => a.userId !== a.doctorUserId)).toBe(
        true,
      );
      expect(equipe.acessos.every((a) => a.userId !== OWNER)).toBe(true);
    });

    it('rodar de novo pula quem já está no ledger', () => {
      const ctx = contextoDeTeste({ usuariosPorEmail: donoExistente() });
      planejarCadastro(exportSintetico(), ctx);
      const segunda = contextoDeTeste({
        usuariosPorEmail: donoExistente(),
        ledger: ctx.ledger,
      });
      const plano = planejarCadastro(exportSintetico(), segunda);

      expect(plano.equipe.usuarios).toHaveLength(0);
      expect(plano.pacientes).toHaveLength(0);
      expect(plano.clinica).toBeNull();
      expect(segunda.relatorio.pulados.paciente).toBe(3);
    });
  });

  describe('clínica', () => {
    it('une grades vigentes e ignora as vencidas', () => {
      const horario = horarioDaClinica(
        exportSintetico().tabela('grade_fixa'),
        '2026-09-26',
      );

      expect(horario.mon).toEqual([{ start: '08:00', end: '16:00' }]);
      expect(horario.wed).toEqual([]);
      expect(horario.sun).toEqual([]);
    });

    it('normaliza CNPJ, CEP e UF', () => {
      const { clinica } = planejarCadastro(
        exportSintetico(),
        contextoDeTeste(),
      );

      expect(clinica).toMatchObject({
        cnpj: '12345678000190',
        zipCode: '25600-000',
        state: 'RJ',
        ownerId: OWNER,
      });
    });
  });

  describe('convênios', () => {
    it('só os usados, sem tipos de consulta, fundindo nomes iguais', () => {
      const { convenios } = planejarCadastro(
        exportSintetico(),
        contextoDeTeste(),
      );

      expect(convenios.map((c) => c.name).sort()).toEqual([
        'GOLDEN CROSS',
        'UNIMED',
      ]);
    });

    it('reaproveita convênio que a conta já tem', () => {
      const ctx = contextoDeTeste({
        conveniosExistentes: new Map([['golden cross', 'hp-existente']]),
      });
      const { convenios } = planejarCadastro(exportSintetico(), ctx);

      expect(convenios.map((c) => c.name)).toEqual(['UNIMED']);
      expect(ctx.ledger.resolver('health_plan', '8')).toBe('hp-existente');
    });
  });

  describe('pacientes', () => {
    const plano = () => {
      const ctx = contextoDeTeste({ usuariosPorEmail: donoExistente() });
      return { ctx, plano: planejarCadastro(exportSintetico(), ctx) };
    };

    it('exclui o excluído e mantém o inativo como inativo', () => {
      const { ctx, plano: p } = plano();

      expect(p.pacientes.map((x) => x.name)).toEqual([
        'Maria Silva',
        'João Souza',
        'maria silva',
      ]);
      expect(p.pacientes[2].active).toBe(false);
      expect(ctx.ledger.resolver(LEDGER_PACIENTE, '12')).toBeNull();
    });

    it('médico responsável é o profissional com mais consultas', () => {
      const { ctx, plano: p } = plano();

      expect(p.pacientes[0].doctorId).toBe(
        ctx.ledger.resolver(LEDGER_PROFISSIONAL, '4'),
      );
      expect(p.pacientes[1].doctorId).toBe(
        ctx.ledger.resolver(LEDGER_PROFISSIONAL, '9'),
      );
      // Sem consulta → dono.
      expect(p.pacientes[2].doctorId).toBe(OWNER);
    });

    it('convênio é o da consulta mais recente com convênio de verdade', () => {
      const { ctx, plano: p } = plano();

      expect(p.pacientes[0].healthPlanId).toBe(
        ctx.ledger.resolver('health_plan', '15'),
      );
      expect(p.pacientes[0].healthPlanNumber).toBe('ABC123');
      // A consulta mais recente do 11 é "CONSULTA PARTICULAR" (tipo de
      // consulta, não convênio): vale a anterior, com UNIMED.
      expect(p.pacientes[1].healthPlanId).toBe(
        ctx.ledger.resolver('health_plan', '14'),
      );
      // Sem convênio em consulta nenhuma → null.
      expect(p.pacientes[2].healthPlanId).toBeNull();
    });

    it('CPF inválido vira null com aviso', () => {
      const { ctx, plano: p } = plano();

      expect(p.pacientes[0].cpf).toBe('52998224725');
      expect(p.pacientes[1].cpf).toBeNull();
      expect(ctx.relatorio.avisos).toContainEqual(
        expect.objectContaining({
          idOrigem: '11',
          aviso: 'CPF inválido descartado',
        }),
      );
    });

    it('telefone principal, secundário e endereço normalizados', () => {
      const { plano: p } = plano();

      expect(p.pacientes[1]).toMatchObject({
        phone: '24988887777',
        secondaryPhone: '2422334455',
      });
      expect(p.pacientes[0]).toMatchObject({
        zipCode: '25600-000',
        state: null,
        city: 'Petrópolis',
      });
    });

    it('avisa nome repetido e grava a data de cadastro original', () => {
      const { ctx, plano: p } = plano();

      expect(ctx.relatorio.avisos).toContainEqual(
        expect.objectContaining({
          idOrigem: '13',
          aviso: 'nome repetido em outro paciente',
          detalhe: 'paciente 10',
        }),
      );
      expect(p.pacientes[0].createdAt.toISOString()).toBe(
        '2023-01-12T03:00:00.000Z',
      );
    });

    it('--somente-com-atividade deixa de fora quem nunca consultou', () => {
      const ctx = contextoDeTeste({
        opcoes: {
          ...contextoDeTeste().opcoes,
          somenteComAtividade: true,
          lembretes: false,
          passadasSemAtendimento: 'manter',
        },
      });
      const p = planejarCadastro(exportSintetico(), ctx);

      expect(p.pacientes.map((x) => x.name)).toEqual([
        'Maria Silva',
        'João Souza',
      ]);
    });
  });

  describe('nomes cortados no export do Feegow', () => {
    it('repara a entidade no fim do nome e avisa; linha deslocada também avisa', () => {
      const ctx = contextoDeTeste({ usuariosPorEmail: donoExistente() });
      const exp = exportSintetico({
        pacientes: [
          {
            id: '50',
            nome_paciente: 'JOS&EACUTE',
            cpf: '(24) 999999999',
            celular: 'alguem@exemplo.com',
            sexo: '1',
            sys_active: '1',
            sys_date: '2023-01-12 00:00:00',
          },
        ],
      });

      const plano = planejarCadastro(exp, ctx);

      expect(plano.pacientes[0].name).toBe('JOSÉ');
      expect(plano.pacientes[0].cpf).toBeNull();
      const avisos = ctx.relatorio.avisos.map((a) => a.aviso);
      expect(avisos).toContain(
        'nome incompleto no export do Feegow: revise o nome no cadastro',
      );
      expect(avisos.some((a) => a.startsWith('colunas deslocadas'))).toBe(true);
    });
  });

  describe('nome que é telefone', () => {
    const paciente = (
      id: string,
      nome: string,
      extra: Record<string, string | null> = {},
    ) => ({
      id,
      nome_paciente: nome,
      cpf: null,
      celular: null,
      sexo: null,
      nascimento: null,
      sys_active: '1',
      sys_date: '2023-01-12 00:00:00',
      ...extra,
    });
    const planejar = (
      pacientes: ReturnType<typeof paciente>[],
      agendamentos: Record<string, string>[] = [],
    ) => {
      const ctx = contextoDeTeste({ usuariosPorEmail: donoExistente() });
      const plano = planejarCadastro(
        exportSintetico({ pacientes, agendamentos }),
        ctx,
      );
      return { ctx, plano };
    };

    it('sem nenhum outro dado fica de fora; com outro dado entra com aviso', () => {
      const { ctx, plano } = planejar([
        paciente('60', '24 98841-4691'),
        paciente('61', '(24) 99999-0000', { email: 'x@exemplo.com' }),
      ]);

      expect(plano.pacientes.map((p) => p.name)).toEqual(['(24) 99999-0000']);
      expect(ctx.relatorio.rejeicoes).toContainEqual(
        expect.objectContaining({
          idOrigem: '60',
          motivo: 'nome sem letras (parece um telefone) e nenhum outro dado',
        }),
      );
      expect(ctx.relatorio.avisos).toContainEqual(
        expect.objectContaining({
          idOrigem: '61',
          aviso: expect.stringContaining('nome sem letras'),
        }),
      );
    });

    it('com consulta entra, para não perder a consulta', () => {
      const { plano } = planejar(
        [paciente('70', '24 98841-4691')],
        [
          {
            id: 'c1',
            paciente_id: '70',
            profissional_id: '1',
            Data: '2025-01-10',
            Hora: '09:00:00',
            sys_active: '1',
          },
        ],
      );
      expect(plano.pacientes).toHaveLength(1);
    });
  });

  it('CPF repetido só avisa — nunca mescla pacientes', () => {
    const ctx = contextoDeTeste({ usuariosPorEmail: donoExistente() });
    const base = {
      cpf: '52998224725',
      celular: null,
      sexo: null,
      nascimento: null,
      sys_active: '1',
      sys_date: '2023-01-12 00:00:00',
    };
    const plano = planejarCadastro(
      exportSintetico({
        pacientes: [
          { ...base, id: '80', nome_paciente: 'Cristina Moura' },
          { ...base, id: '81', nome_paciente: 'Cristina Maria Moura' },
        ],
      }),
      ctx,
    );

    expect(plano.pacientes).toHaveLength(2);
    expect(ctx.ledger.resolver(LEDGER_PACIENTE, '80')).not.toBe(
      ctx.ledger.resolver(LEDGER_PACIENTE, '81'),
    );
    expect(ctx.relatorio.avisos).toContainEqual(
      expect.objectContaining({
        idOrigem: '81',
        aviso: 'CPF repetido em outro paciente',
      }),
    );
  });
});
