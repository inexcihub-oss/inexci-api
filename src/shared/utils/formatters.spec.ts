import {
  formatAppointmentWhen,
  formatClinicAddress,
  formatDoctorName,
  todayBR,
} from './formatters';

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

  it('não confunde nome próprio começado por Dr', () => {
    expect(formatDoctorName('Drauzio Varella')).toBe('Dr(a). Drauzio Varella');
  });

  it('devolve string vazia sem nome', () => {
    expect(formatDoctorName(undefined)).toBe('');
    expect(formatDoctorName(null)).toBe('');
    expect(formatDoctorName('   ')).toBe('');
  });
});

describe('formatAppointmentWhen', () => {
  it('formata dia da semana, data e hora no fuso de São Paulo', () => {
    expect(formatAppointmentWhen(new Date('2026-08-01T17:00:00.000Z'))).toBe(
      'sáb., 01/08 às 14:00',
    );
  });
});

describe('formatClinicAddress', () => {
  it('monta logradouro, número, bairro e cidade/UF', () => {
    expect(
      formatClinicAddress({
        address: 'Rua das Flores',
        addressNumber: '120',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
      }),
    ).toBe('Rua das Flores, 120 - Centro, São Paulo/SP');
  });

  it('omite o número quando não há', () => {
    expect(
      formatClinicAddress({
        address: 'Rua das Flores',
        addressNumber: null,
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
      }),
    ).toBe('Rua das Flores - Centro, São Paulo/SP');
  });

  it('omite o bairro quando não há', () => {
    expect(
      formatClinicAddress({
        address: 'Rua das Flores',
        addressNumber: '120',
        neighborhood: null,
        city: 'São Paulo',
        state: 'SP',
      }),
    ).toBe('Rua das Flores, 120, São Paulo/SP');
  });

  it('usa só a cidade quando não há UF', () => {
    expect(
      formatClinicAddress({
        address: 'Rua das Flores',
        addressNumber: '120',
        neighborhood: null,
        city: 'São Paulo',
        state: null,
      }),
    ).toBe('Rua das Flores, 120, São Paulo');
  });

  it('devolve vazio quando não há logradouro', () => {
    expect(
      formatClinicAddress({
        address: null,
        addressNumber: '120',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
      }),
    ).toBe('');
    expect(formatClinicAddress(null)).toBe('');
  });
});

describe('todayBR', () => {
  it('usa o dia de São Paulo, não o de UTC', () => {
    expect(todayBR(new Date('2026-10-08T02:59:00Z'))).toBe('07/10/2026');
    expect(todayBR(new Date('2026-10-08T03:00:00Z'))).toBe('08/10/2026');
  });

  it('formata com zeros à esquerda', () => {
    expect(todayBR(new Date('2026-01-05T15:00:00Z'))).toBe('05/01/2026');
  });
});
