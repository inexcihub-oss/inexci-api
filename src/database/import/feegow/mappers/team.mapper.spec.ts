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
  ])('%s → %s', (especialidade, conselho) => {
    expect(conselhoPelaEspecialidade(especialidade)).toBe(conselho);
  });

  it('especialidade desconhecida ou ausente não vira CRM', () => {
    expect(conselhoPelaEspecialidade('Esteticista')).toBeNull();
    expect(conselhoPelaEspecialidade('')).toBeNull();
    expect(conselhoPelaEspecialidade(null)).toBeNull();
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
});
