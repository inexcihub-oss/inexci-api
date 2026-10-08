import { profissionaisPorPaciente } from './primary-doctor.rule';

const ag = (paciente: string, prof: string, data: string, ativo = '1') => ({
  paciente_id: paciente,
  profissional_id: prof,
  Data: data,
  Hora: '09:00:00',
  sys_active: ativo,
});

describe('profissionaisPorPaciente', () => {
  it('ordena pelo número de consultas', () => {
    const r = profissionaisPorPaciente([
      ag('p1', '9', '2025-01-01'),
      ag('p1', '1', '2025-02-01'),
      ag('p1', '1', '2025-03-01'),
    ]);
    expect(r.get('p1')).toEqual(['1', '9']);
  });

  it('empate fica com a consulta mais recente', () => {
    const r = profissionaisPorPaciente([
      ag('p1', '1', '2024-01-01'),
      ag('p1', '4', '2025-06-01'),
    ]);
    expect(r.get('p1')).toEqual(['4', '1']);
  });

  it('ignora agendamento excluído e sem paciente', () => {
    const r = profissionaisPorPaciente([
      ag('p1', '1', '2025-01-01', '-1'),
      { ...ag('', '1', '2025-01-01'), paciente_id: null },
    ]);
    expect(r.size).toBe(0);
  });
});
