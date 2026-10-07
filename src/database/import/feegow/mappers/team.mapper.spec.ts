import { ProfessionalCouncil } from 'src/database/entities/doctor-profile.entity';
import { contextoDeTeste, exportSintetico } from '../testing/export-sintetico';
import { conselhoPelaEspecialidade, planejarEquipe } from './team.mapper';

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
        aviso: expect.stringContaining('CRM sem número'),
      }),
    );
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
      expect(ctx.relatorio.avisos).toEqual([]);
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
