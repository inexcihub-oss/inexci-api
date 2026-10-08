import { LinhaCsv } from '../../core/csv';
import { contatosDoPaciente } from './patient.mapper';

const LONGO = `${'a'.repeat(95)}@clinica.com`; // 107 > patients.email (100)

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
