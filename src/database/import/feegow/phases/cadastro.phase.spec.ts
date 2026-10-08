import { ProfessionalCouncil } from 'src/database/entities/doctor-profile.entity';
import { UserStatus } from 'src/database/entities/user.entity';
import { Permission } from 'src/shared/permissions/permission.enum';
import { horarioDaClinica } from '../mappers/clinic.mapper';
import { LEDGER_PACIENTE } from '../mappers/patient.mapper';
import { LEDGER_PROFISSIONAL } from '../mappers/team.mapper';
import {
  ag,
  contextoDeTeste,
  exportSintetico,
  OWNER,
} from '../testing/export-sintetico';

const pac = (id: string, nome: string, ativo: string) => ({
  id,
  nome_paciente: nome,
  cpf: null,
  celular: '24999991234',
  sexo: '2',
  nascimento: '1990-05-02',
  sys_active: ativo,
  sys_date: '2023-01-12 00:00:00',
});
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

    it('carteirinha é a matrícula do convênio escolhido, não a primeira', () => {
      const ctx = contextoDeTeste();
      const p = planejarCadastro(
        exportSintetico({
          paciente_convenio: [
            {
              paciente_id: '10',
              convenio_id1: '8',
              matricula1: 'GOLD-1',
              convenio_id2: '15',
              matricula2: 'UNI-2',
            },
            // O 11 tem só GOLDEN CROSS no cadastro, mas a consulta escolhe
            // UNIMED: sem matrícula correspondente, fica sem número.
            { paciente_id: '11', convenio_id1: '8', matricula1: 'GOLD-11' },
          ],
        }),
        ctx,
      );

      expect(p.pacientes[0].healthPlanNumber).toBe('UNI-2');
      expect(p.pacientes[1].healthPlanId).toBe(
        ctx.ledger.resolver('health_plan', '14'),
      );
      expect(p.pacientes[1].healthPlanNumber).toBeNull();
    });

    it('CPF inválido vira null, com aviso e o valor original nas observações', () => {
      const { ctx, plano: p } = plano();

      expect(p.pacientes[0].cpf).toBe('52998224725');
      expect(p.pacientes[1].cpf).toBeNull();
      expect(p.pacientes[1].medicalNotes).toContain(
        'CPF no Feegow (inválido): 11111111111',
      );
      expect(ctx.relatorio.avisos).toContainEqual(
        expect.objectContaining({
          idOrigem: '11',
          aviso: 'CPF inválido: fica só nas observações',
        }),
      );
    });

    it('excluído com consulta, prontuário ou anexo entra inativo; sem nada, fica fora', () => {
      const ctx = contextoDeTeste({ usuariosPorEmail: donoExistente() });
      const exp = exportSintetico({
        pacientes: [
          pac('20', 'Ana Duplicada', '-1'),
          pac('21', 'Bruno Duplicado', '-1'),
          pac('22', 'Clara Duplicada', '-1'),
          pac('23', 'Davi Sem Nada', '-1'),
        ],
        agendamentos: [ag('20', '4', '2025-01-10', '0')],
        formularios_preenchidos: [
          { id: 'f1', paciente_id: '21', modelo_id: '3', sys_active: '1' },
        ],
        arquivos: [
          { id: 'a1', PacienteID: '22', NomeArquivo: 'x.pdf', sysActive: '1' },
        ],
      });

      const { pacientes } = planejarCadastro(exp, ctx);

      expect(pacientes.map((x) => [x.name, x.active])).toEqual([
        ['Ana Duplicada', false],
        ['Bruno Duplicado', false],
        ['Clara Duplicada', false],
      ]);
      expect(pacientes[0].medicalNotes).toContain('excluído no Feegow');
      expect(ctx.ledger.resolver(LEDGER_PACIENTE, '23')).toBeNull();
      expect(ctx.relatorio.avisos).toContainEqual(
        expect.objectContaining({
          idOrigem: '20',
          aviso: expect.stringContaining('entra inativo'),
        }),
      );
    });

    it('telefone incompleto e nascimento impossível vão para as observações', () => {
      const ctx = contextoDeTeste({ usuariosPorEmail: donoExistente() });
      const exp = exportSintetico({
        pacientes: [
          {
            ...pac('24', 'Eva Lima', '1'),
            fixo_2: '(24) 9817-340',
            nascimento: '1853-08-24',
          },
        ],
      });

      const [eva] = planejarCadastro(exp, ctx).pacientes;

      expect(eva.birthDate).toBeNull();
      expect(eva.phone).toBe('24999991234');
      expect(eva.medicalNotes).toBe(
        'Telefone no Feegow (incompleto): (24) 9817-340\nNascimento no Feegow (inválido): 1853-08-24',
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
          semLembretes: false,
          donoNaoProfissional: false,
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
      expect(avisos).not.toContain('CPF inválido: fica só nas observações');
    });

    it('recupera telefone, e-mail e nascimento das colunas deslocadas', () => {
      const ctx = contextoDeTeste({ usuariosPorEmail: donoExistente() });
      const exp = exportSintetico({
        pacientes: [
          // telefone no CPF, e-mail no celular, nascimento no fixo
          {
            id: '50',
            nome_paciente: 'F&AACUTE',
            cpf: '(24) 988067366',
            celular: 'ALGUEM@EXEMPLO.COM',
            fixo_1: '03/01/1972 00:00:00',
            sys_active: '1',
          },
          // telefone no lugar, e-mail no fixo, nascimento no e-mail
          {
            id: '51',
            nome_paciente: 'JOS&EACUTE',
            celular: '(24) 2017-4722',
            fixo_1: 'outro@exemplo.com',
            email: '08/10/1940 00:00:00',
            sys_active: '1',
          },
        ],
      });

      const plano = planejarCadastro(exp, ctx);

      expect(plano.pacientes[0]).toMatchObject({
        cpf: null,
        phone: '24988067366',
        email: 'alguem@exemplo.com',
        birthDate: '1972-01-03',
        medicalNotes: null,
      });
      expect(plano.pacientes[1]).toMatchObject({
        phone: '2420174722',
        email: 'outro@exemplo.com',
        birthDate: '1940-10-08',
        medicalNotes: null,
      });
      expect(ctx.relatorio.avisos).toContainEqual(
        expect.objectContaining({
          idOrigem: '50',
          aviso: expect.stringContaining('colunas deslocadas'),
          detalhe: 'e-mail, nascimento, telefone',
        }),
      );
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
          motivo: 'nome sem letras e nenhum outro dado',
        }),
      );
      expect(ctx.relatorio.avisos).toContainEqual(
        expect.objectContaining({
          idOrigem: '61',
          aviso: expect.stringContaining('nome sem letras'),
        }),
      );
    });

    it('descarte não deixa aviso nem bloqueia o nome para outro registro', () => {
      const { ctx, plano } = planejar([
        paciente('60', '24 98841-4691'),
        paciente('62', '24 98841-4691', { email: 'y@exemplo.com' }),
      ]);

      expect(plano.pacientes).toHaveLength(1);
      const doDescartado = ctx.relatorio.avisos.filter(
        (a) => a.idOrigem === '60',
      );
      expect(doDescartado).toEqual([]);
      expect(ctx.relatorio.avisos).not.toContainEqual(
        expect.objectContaining({
          idOrigem: '62',
          aviso: 'nome repetido em outro paciente',
        }),
      );
    });

    it.each([
      ['observações', { Observacoes: 'Alergia a dipirona' }],
      ['bairro', {}],
    ])('com %s entra', (_, extra) => {
      const ctx = contextoDeTeste({ usuariosPorEmail: donoExistente() });
      const plano = planejarCadastro(
        exportSintetico({
          pacientes: [paciente('63', '24 98841-4691', extra)],
          paciente_endereco:
            _ === 'bairro' ? [{ paciente_id: '63', bairro: 'Centro' }] : [],
        }),
        ctx,
      );
      expect(plano.pacientes).toHaveLength(1);
    });

    it('preenchimento vazio do Feegow não conta como dado', () => {
      const { plano } = planejar([
        paciente('66', '24 98841-4691', {
          Peso: '0.00',
          Altura: '0',
          nascimento: '0000-00-00',
          celular: '(  )     -    ',
          cpf: '000.000.000-00',
          estado_civil_id: '0',
        }),
      ]);
      expect(plano.pacientes).toEqual([]);
    });

    it('com anexo ou foto entra, para não perder os arquivos', () => {
      const ctx = contextoDeTeste({ usuariosPorEmail: donoExistente() });
      const plano = planejarCadastro(
        exportSintetico({
          pacientes: [
            paciente('64', '24 98841-4691'),
            paciente('65', '24 98841-0000', { foto: 'foto.jpg' }),
          ],
          arquivos: [
            {
              id: 'a1',
              PacienteID: '64',
              NomeArquivo: 'exame.pdf',
              sysActive: '1',
            },
          ],
        }),
        ctx,
      );
      expect(plano.pacientes).toHaveLength(2);
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
