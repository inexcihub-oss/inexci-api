import { LinhaCsv } from '../../core/csv';
import { contatosDoPaciente, matriculaDoConvenio } from './patient.mapper';

const LONGO = `${'a'.repeat(95)}@clinica.com`;

describe('contatosDoPaciente — e-mail maior que a coluna', () => {
  it('descarta o e-mail longo, marca e guarda nas observações', () => {
    const r = contatosDoPaciente({ id: '1', email: LONGO } as LinhaCsv);
    expect(r.email).toBeNull();
    expect(r.emailLongo).toBe(true);
    expect(r.naoReconhecidos).toEqual([expect.stringContaining(LONGO)]);
    expect(r.deslocados).toEqual([]);
  });

  it('e-mail deslocado longo não ocupa o campo; o que cabe entra', () => {
    const r = contatosDoPaciente({
      id: '1',
      cpf: LONGO,
      fixo_1: 'ana@clinica.com',
    } as LinhaCsv);
    expect(r.email).toBe('ana@clinica.com');
    expect(r.emailLongo).toBe(false);
    expect(r.naoReconhecidos).toEqual([`Outro e-mail no Feegow: ${LONGO}`]);
  });

  it('só e-mail deslocado longo: campo vazio e aviso', () => {
    const r = contatosDoPaciente({ id: '1', cpf: LONGO } as LinhaCsv);
    expect(r.email).toBeNull();
    expect(r.emailLongo).toBe(true);
    expect(r.deslocados).toEqual([]);
  });

  it('e-mail normal continua entrando', () => {
    const r = contatosDoPaciente({
      id: '1',
      email: 'Ana@Clinica.com',
    } as LinhaCsv);
    expect(r.email).toBe('ana@clinica.com');
    expect(r.emailLongo).toBe(false);
  });
});

describe('matriculaDoConvenio', () => {
  const conv = {
    paciente_id: '10',
    convenio_id1: '8',
    matricula1: 'GOLD-1',
    convenio_id2: '15',
    matricula2: 'UNI-2',
    convenio_id3: '0',
    matricula3: 'LIXO',
  } as LinhaCsv;

  it('pega a matrícula do mesmo slot do convênio escolhido', () => {
    expect(matriculaDoConvenio(conv, '15')).toBe('UNI-2');
    expect(matriculaDoConvenio(conv, '8')).toBe('GOLD-1');
  });

  it('convênio fora do cadastro do paciente não leva matrícula de outro', () => {
    expect(matriculaDoConvenio(conv, '99')).toBeNull();
    expect(matriculaDoConvenio(undefined, '15')).toBeNull();
    expect(matriculaDoConvenio(conv, null)).toBeNull();
  });

  it('aceita o slot cujo convênio foi fundido com o escolhido', () => {
    expect(matriculaDoConvenio(conv, '14', (id) => id === '15')).toBe('UNI-2');
  });
});
