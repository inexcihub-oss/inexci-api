import { LinhaCsv } from '../../core/csv';
import { ExportFeegow } from '../export';
import { contextoDeTeste } from '../testing/export-sintetico';
import { horarioDaClinica, planejarClinica } from './clinic.mapper';

const grade = (dia: string, fim: string | null) =>
  ({
    dia_semana: dia,
    hora_de: '08:00:00',
    hora_ate: '12:00:00',
    fim_vigencia: fim,
  }) as LinhaCsv;

describe('horarioDaClinica — fim de vigência', () => {
  it('normaliza a data como planejarGrades: 0000-00-00 é "sem fim" e DD/MM/AAAA vale', () => {
    const horario = horarioDaClinica(
      [
        grade('2', '0000-00-00'),
        grade('3', '31/12/2099'),
        grade('4', '01/01/2020'),
        grade('5', '2020-01-01'),
        grade('6', '2026-09-26'),
      ],
      '2026-09-26',
    );
    const manha = [{ start: '08:00', end: '12:00' }];
    expect(horario.mon).toEqual(manha);
    expect(horario.tue).toEqual(manha);
    expect(horario.wed).toEqual([]);
    expect(horario.thu).toEqual([]);
    expect(horario.fri).toEqual(manha);
  });
});

describe('planejarClinica — e-mail maior que clinics.email', () => {
  it('descarta com aviso e usa o segundo e-mail se couber', () => {
    const ctx = contextoDeTeste();
    const exp = new ExportFeegow(null, {
      unidades: [
        {
          id: '0',
          nome_fantasia: 'Clínica',
          email1: `${'a'.repeat(95)}@clinica.com`,
          email2: 'contato@clinica.com',
        },
      ],
    } as unknown as Record<string, LinhaCsv[]>);
    const clinica = planejarClinica(exp, ctx);
    expect(clinica?.email).toBe('contato@clinica.com');
    expect(ctx.relatorio.avisos).toContainEqual(
      expect.objectContaining({
        entidade: 'clínica',
        aviso: expect.stringContaining('mais de 100 caracteres'),
      }),
    );
  });
});
