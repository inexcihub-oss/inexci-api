import {
  aplicarPlaceholders,
  DOCUMENT_PLACEHOLDERS,
} from './placeholders.util';

describe('aplicarPlaceholders (MIG-06)', () => {
  const valores = {
    'paciente.nome': 'Maria Silva',
    'paciente.cpf': '529.982.247-25',
    'paciente.nascimento': '02/05/1990',
    'medico.nome': 'Dr. João',
    'medico.registro': 'CRM 12345/RJ',
    data: '01/10/2026',
    dias: 3,
  };

  it('preenche todos os placeholders conhecidos', () => {
    const texto = Object.keys(DOCUMENT_PLACEHOLDERS)
      .map((k) => `{{${k}}}`)
      .join('|');
    expect(aplicarPlaceholders(texto, valores)).toBe(
      'Maria Silva|529.982.247-25|02/05/1990|Dr. João|CRM 12345/RJ|01/10/2026|3',
    );
  });

  it('aceita espaços dentro das chaves e repetições', () => {
    expect(
      aplicarPlaceholders('{{ paciente.nome }} e {{paciente.nome}}', valores),
    ).toBe('Maria Silva e Maria Silva');
  });

  it('conhecido sem valor vira vazio; desconhecido fica literal', () => {
    expect(
      aplicarPlaceholders('CPF: {{paciente.cpf}} {{paciente.mae}}', {
        'paciente.nome': 'X',
      }),
    ).toBe('CPF:  {{paciente.mae}}');
  });

  it('não interpreta o valor como placeholder nem como HTML', () => {
    expect(
      aplicarPlaceholders('{{paciente.nome}}', {
        'paciente.nome': '<b>{{dias}}</b>',
        dias: 9,
      }),
    ).toBe('<b>{{dias}}</b>');
  });

  it('mantém as quebras de linha do texto', () => {
    expect(aplicarPlaceholders('Linha 1\n{{data}}', valores)).toBe(
      'Linha 1\n01/10/2026',
    );
  });
});
