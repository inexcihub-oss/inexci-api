import { ProfessionalCouncil } from 'src/database/entities/doctor-profile.entity';
import {
  contextoDeTeste,
  exportSintetico,
  OWNER,
} from '../testing/export-sintetico';
import {
  conselhoPelaEspecialidade,
  LEDGER_PROFISSIONAL,
  planejarEquipe,
} from './team.mapper';

describe('conselhoPelaEspecialidade', () => {
  it.each([
    ['Enfermagem', ProfessionalCouncil.COREN],
    ['Enfermagem (Técnico)', ProfessionalCouncil.COREN],
    ['Nutrição', ProfessionalCouncil.CRN],
    ['Psicologia (Psicoterapia)', ProfessionalCouncil.CRP],
    ['Fisioterapia', ProfessionalCouncil.CREFITO],
    ['Ortopedia e Traumatologia', ProfessionalCouncil.CRM],
    ['Clínica Geral', ProfessionalCouncil.CRM],
    ['Medicina da Dor', ProfessionalCouncil.CRM],
    ['Cirurgia Plástica', ProfessionalCouncil.CRM],
    ['Acupuntura Médica', ProfessionalCouncil.CRM],
    ['Radiologia', ProfessionalCouncil.CRM],
    ['Cirurgia Bucomaxilofacial', ProfessionalCouncil.CRO],
  ])('%s → %s', (especialidade, conselho) => {
    expect(conselhoPelaEspecialidade(especialidade)).toBe(conselho);
  });

  it('especialidade desconhecida ou ausente não vira CRM', () => {
    expect(conselhoPelaEspecialidade('Esteticista')).toBeNull();
    expect(conselhoPelaEspecialidade('')).toBeNull();
    expect(conselhoPelaEspecialidade(null)).toBeNull();
  });

  it.each([
    'Instrumentação Cirúrgica',
    'Técnico em Radiologia',
    'Medicina Veterinária',
    'Farmácia',
  ])('%s não é médico e não deduz conselho', (especialidade) => {
    expect(conselhoPelaEspecialidade(especialidade)).toBeNull();
  });

  it('várias especialidades: ignora as desconhecidas, conflito ou veto → nenhum', () => {
    expect(conselhoPelaEspecialidade(['Ortopedia', 'Cirurgia da Mão'])).toBe(
      ProfessionalCouncil.CRM,
    );
    expect(conselhoPelaEspecialidade(['Ortopedia', 'Acupuntura'])).toBe(
      ProfessionalCouncil.CRM,
    );
    expect(
      conselhoPelaEspecialidade(['Enfermagem', 'Clínica Geral']),
    ).toBeNull();
    expect(
      conselhoPelaEspecialidade(['Cirurgia Geral', 'Instrumentação Cirúrgica']),
    ).toBeNull();
    expect(conselhoPelaEspecialidade(['Estética', 'Acupuntura'])).toBeNull();
  });
});

describe('planejarEquipe — profissional sem conselho no Feegow', () => {
  const exportCom = () =>
    exportSintetico({
      especialidades: [
        { id: '1', nome_especialidade: 'Clínica Geral' },
        { id: '2', nome_especialidade: 'Enfermagem (Técnico)' },
        { id: '3', nome_especialidade: 'Estética' },
      ],
      profissional_especialidades: [
        { profissional_id: '6', especialidade_id: '1' },
        { profissional_id: '7', especialidade_id: '2' },
        { profissional_id: '8', especialidade_id: '3' },
      ],
      profissionais: [
        {
          id: '6',
          nome_profissional: 'Karina Clínica',
          conselho_id: '0',
          documento_conselho: null,
          email1: 'karina@exemplo.com',
          celular1: '24999990006',
          ativo: 'on',
          sys_active: '1',
        },
        {
          id: '7',
          nome_profissional: 'Luana Técnica',
          conselho_id: '0',
          documento_conselho: null,
          email1: 'luana@exemplo.com',
          celular1: '24999990007',
          ativo: 'on',
          sys_active: '1',
        },
        {
          id: '8',
          nome_profissional: 'Gleysi Estética',
          conselho_id: '0',
          documento_conselho: null,
          email1: 'gleysi@exemplo.com',
          celular1: '24999990008',
          ativo: 'on',
          sys_active: '1',
        },
      ],
    });

  it('deduz o conselho pela especialidade e avisa para conferir', () => {
    const ctx = contextoDeTeste();
    const { perfis } = planejarEquipe(exportCom(), ctx);

    expect(perfis.map((p) => p.council)).toEqual([
      ProfessionalCouncil.CRM,
      ProfessionalCouncil.COREN,
      ProfessionalCouncil.OUTRO,
    ]);
    const avisos = ctx.relatorio.avisos;
    expect(avisos).toContainEqual(
      expect.objectContaining({
        idOrigem: '7',
        aviso: expect.stringContaining('entra como COREN'),
      }),
    );
    expect(avisos).toContainEqual(
      expect.objectContaining({
        idOrigem: '8',
        aviso: expect.stringContaining('entra como OUTRO'),
      }),
    );
  });

  it('CRM deduzido sem número avisa que não emite documento até preencher', () => {
    const ctx = contextoDeTeste();
    planejarEquipe(exportCom(), ctx);

    expect(ctx.relatorio.avisos).toContainEqual(
      expect.objectContaining({
        idOrigem: '6',
        aviso: expect.stringContaining('CRM sem número e sem UF'),
      }),
    );
  });

  it('não médico (COREN) não ganha aviso de registro: não emite documento de todo jeito', () => {
    const ctx = contextoDeTeste();
    planejarEquipe(exportCom(), ctx);

    expect(
      ctx.relatorio.avisos.filter(
        (a) => a.idOrigem === '7' && a.aviso.includes('sem UF'),
      ),
    ).toEqual([]);
  });

  it('conselho do Feegow que a INEXCI não tem fica OUTRO, sem deduzir', () => {
    const ctx = contextoDeTeste();
    const { perfis } = planejarEquipe(
      exportSintetico({
        conselhos_profissionais: [{ id: '9', codigo: 'CRMV' }],
        especialidades: [{ id: '1', nome_especialidade: 'Cirurgia Geral' }],
        profissional_especialidades: [
          { profissional_id: '6', especialidade_id: '1' },
        ],
        profissionais: [
          {
            id: '6',
            nome_profissional: 'Vera Vet',
            conselho_id: '9',
            documento_conselho: '1234',
            email1: 'vera@exemplo.com',
            celular1: '24999990006',
            ativo: 'on',
            sys_active: '1',
          },
        ],
      }),
      ctx,
    );

    expect(perfis[0].council).toBe(ProfessionalCouncil.OUTRO);
    expect(ctx.relatorio.avisos).toContainEqual(
      expect.objectContaining({
        idOrigem: '6',
        aviso: expect.stringContaining('conselho CRMV do Feegow não existe'),
      }),
    );
  });

  it('com especialidades conflitantes fica OUTRO e guarda todas', () => {
    const ctx = contextoDeTeste();
    const { perfis } = planejarEquipe(
      exportSintetico({
        especialidades: [
          { id: '1', nome_especialidade: 'Enfermagem' },
          { id: '2', nome_especialidade: 'Clínica Geral' },
        ],
        profissional_especialidades: [
          { profissional_id: '6', especialidade_id: '1' },
          { profissional_id: '6', especialidade_id: '2' },
        ],
        profissionais: [
          {
            id: '6',
            nome_profissional: 'Karina Clínica',
            conselho_id: '0',
            documento_conselho: null,
            email1: 'karina@exemplo.com',
            celular1: '24999990006',
            ativo: 'on',
            sys_active: '1',
          },
        ],
      }),
      ctx,
    );

    expect(perfis[0].council).toBe(ProfessionalCouncil.OUTRO);
    expect(perfis[0].specialty).toBe('Enfermagem, Clínica Geral');
  });

  it.each(['CRM-SP', 'CRM/RJ', 'crm.', ' CRM '])(
    'código "%s" do Feegow é CRM, sem aviso de conselho desconhecido',
    (codigo) => {
      const ctx = contextoDeTeste();
      const { perfis } = planejarEquipe(
        exportSintetico({
          conselhos_profissionais: [{ id: '9', codigo }],
          profissionais: [
            {
              id: '6',
              nome_profissional: 'Otávio Ortopedista',
              conselho_id: '9',
              documento_conselho: '1234',
              email1: 'otavio@exemplo.com',
              celular1: '24999990006',
              ativo: 'on',
              sys_active: '1',
            },
          ],
        }),
        ctx,
      );

      expect(perfis[0].council).toBe(ProfessionalCouncil.CRM);
      expect(ctx.relatorio.avisos).not.toContainEqual(
        expect.objectContaining({
          aviso: expect.stringContaining('não existe na INEXCI'),
        }),
      );
    },
  );

  it.each([
    ['CRM', ProfessionalCouncil.CRM, 'indicação cirúrgica'],
    ['CRO', ProfessionalCouncil.CRO, 'pedido de exame'],
  ])(
    '%s com número e sem UF (o Feegow não guarda) avisa que não emite até completar',
    (codigo, conselho, ato) => {
      const ctx = contextoDeTeste();
      const { perfis } = planejarEquipe(
        exportSintetico({
          conselhos_profissionais: [{ id: '9', codigo }],
          profissionais: [
            {
              id: '6',
              nome_profissional: 'Otávio Ortopedista',
              conselho_id: '9',
              documento_conselho: '52934046',
              email1: 'otavio@exemplo.com',
              celular1: '24999990006',
              ativo: 'on',
              sys_active: '1',
            },
          ],
        }),
        ctx,
      );

      expect(perfis[0]).toMatchObject({
        council: conselho,
        crm: '52934046',
        crmState: null,
      });
      expect(ctx.relatorio.avisos).toContainEqual(
        expect.objectContaining({
          idOrigem: '6',
          aviso: expect.stringMatching(
            new RegExp(`^${codigo} sem UF .*${ato}`),
          ),
        }),
      );
    },
  );

  it('especialidade repetida aparece uma vez', () => {
    const { perfis } = planejarEquipe(
      exportSintetico({
        especialidades: [{ id: '1', nome_especialidade: 'Ortopedia' }],
        profissional_especialidades: [
          { profissional_id: '6', especialidade_id: '1' },
          { profissional_id: '6', especialidade_id: '1' },
        ],
        profissionais: [
          {
            id: '6',
            nome_profissional: 'Otávio Ortopedista',
            conselho_id: '0',
            documento_conselho: '1234',
            email1: 'otavio@exemplo.com',
            celular1: '24999990006',
            ativo: 'on',
            sys_active: '1',
          },
        ],
      }),
      contextoDeTeste(),
    );

    expect(perfis[0].specialty).toBe('Ortopedia');
  });
});

describe('planejarEquipe — e-mail de usuário excluído na INEXCI', () => {
  const exp = () =>
    exportSintetico({
      profissionais: [
        {
          id: '6',
          nome_profissional: 'Karina Clínica',
          conselho_id: '1',
          documento_conselho: '123',
          email1: 'karina@exemplo.com',
          celular1: '24999990006',
          ativo: 'on',
          sys_active: '1',
        },
      ],
    });

  it('não casa com o ex-colaborador excluído nem tenta recriar o e-mail', () => {
    const ctx = contextoDeTeste({
      usuariosPorEmail: new Map([
        [
          'karina@exemplo.com',
          {
            id: 'ex-karina',
            ownerId: OWNER,
            email: 'karina@exemplo.com',
            temPerfil: true,
            excluido: true,
          },
        ],
      ]),
    });
    const plano = planejarEquipe(exp(), ctx);

    expect(plano.usuarios.map((u) => u.email)).not.toContain(
      'karina@exemplo.com',
    );
    expect(ctx.ledger.resolver(LEDGER_PROFISSIONAL, '6')).toBeNull();
    expect(ctx.relatorio.rejeicoes).toContainEqual(
      expect.objectContaining({
        idOrigem: '6',
        motivo: expect.stringContaining('usuário excluído'),
      }),
    );
  });
});

describe('planejarEquipe — e-mail maior que users.email', () => {
  it('descarta com aviso (e rejeita por falta de e-mail válido)', () => {
    const ctx = contextoDeTeste();
    const exp = exportSintetico({
      profissionais: [
        {
          id: '6',
          nome_profissional: 'Karina Clínica',
          conselho_id: '1',
          documento_conselho: '123',
          email1: `${'a'.repeat(150)}@clinica.com`,
          celular1: '24999990006',
          ativo: 'on',
          sys_active: '1',
        },
      ],
    });
    const plano = planejarEquipe(exp, ctx);
    expect(plano.usuarios.map((u) => u.name)).not.toContain('Karina Clínica');
    expect(ctx.relatorio.rejeicoes).toContainEqual(
      expect.objectContaining({ idOrigem: '6' }),
    );
    expect(ctx.relatorio.avisos).toContainEqual(
      expect.objectContaining({
        idOrigem: '6',
        aviso: expect.stringContaining('mais de 160 caracteres'),
      }),
    );
  });
});
