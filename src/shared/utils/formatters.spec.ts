import { formatDoctorName } from './formatters';

/**
 * D-07: a tela e o e-mail de lembrete prefixavam "Dr(a)." em um nome que já
 * vinha com o tratamento, produzindo "Dr(a). Dr. Carlos Mendonça".
 */
describe('formatDoctorName', () => {
  it('prefixa o tratamento em nome sem título', () => {
    expect(formatDoctorName('Carlos Mendonça')).toBe('Dr(a). Carlos Mendonça');
  });

  it.each([
    'Dr. Carlos Mendonça',
    'Dra. Ana Souza',
    'Dr(a). Paulo Lima',
    'dr. carlos',
    'Dr Carlos',
  ])('mantém o nome que já traz o tratamento: %s', (name) => {
    expect(formatDoctorName(name)).toBe(name);
  });

  /** "Drauzio" começa com "Dra" mas não é tratamento. */
  it('não confunde nome próprio começado por Dr', () => {
    expect(formatDoctorName('Drauzio Varella')).toBe('Dr(a). Drauzio Varella');
  });

  it('devolve string vazia sem nome', () => {
    expect(formatDoctorName(undefined)).toBe('');
    expect(formatDoctorName(null)).toBe('');
    expect(formatDoctorName('   ')).toBe('');
  });
});
