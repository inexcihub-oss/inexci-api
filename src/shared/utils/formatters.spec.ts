import {
  formatAppointmentWhen,
  formatClinicAddress,
  formatDoctorName,
} from './formatters';

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

describe('formatAppointmentWhen', () => {
  it('formata dia da semana, data e hora no fuso de São Paulo', () => {
    // 14:00 em São Paulo (UTC-3) — se cair no fuso do servidor, vira 17:00.
    expect(formatAppointmentWhen(new Date('2026-08-01T17:00:00.000Z'))).toBe(
      'sáb., 01/08 às 14:00',
    );
  });
});

/**
 * Endereço da unidade em uma linha, para mensagens de texto livre no WhatsApp.
 * Todos os campos são opcionais na entidade, então cada pedaço só entra se
 * existir — nunca sai vírgula ou barra solta.
 */
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

  /** Sem logradouro não há endereço a mostrar, por mais campos que existam. */
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
