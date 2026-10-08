import {
  aplicarPlaceholders,
  aplicarPlaceholdersDetalhado,
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
    inicio: '02/10/2026',
  };

  it('preenche todos os placeholders conhecidos', () => {
    const texto = Object.keys(DOCUMENT_PLACEHOLDERS)
      .map((k) => `{{${k}}}`)
      .join('|');
    expect(aplicarPlaceholders(texto, valores)).toBe(
      'Maria Silva|529.982.247-25|02/05/1990|Dr. João|CRM 12345/RJ|01/10/2026|3|02/10/2026',
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

  it('mantém literal a chave sem valor listada em manterSemValor', () => {
    expect(
      aplicarPlaceholders(
        '{{paciente.nome}}: {{dias}} dias a partir de {{inicio}}; CPF {{paciente.cpf}}',
        { 'paciente.nome': 'Maria' },
        { manterSemValor: ['dias', 'inicio'] },
      ),
    ).toBe('Maria: {{dias}} dias a partir de {{inicio}}; CPF ');
  });

  it('manterSemValor não impede preencher quando o valor existe', () => {
    expect(
      aplicarPlaceholders(
        '{{dias}} dias',
        { dias: 5 },
        {
          manterSemValor: ['dias'],
        },
      ),
    ).toBe('5 dias');
  });
});

describe('aplicarPlaceholders — concordância de {{dias}}', () => {
  it.each([
    ['período de {{dias}} dias.', 1, 'período de 1 dia.'],
    ['período de {{dias}} dias.', 3, 'período de 3 dias.'],
    ['período de {{dias}} dia.', 2, 'período de 2 dias.'],
    ['período de {{dias}} dia(s).', 1, 'período de 1 dia.'],
    // A caixa da palavra do modelo é preservada.
    ['período de {{ dias }} DIAS', 1, 'período de 1 DIA'],
    ['período de {{dias}} DIA', 3, 'período de 3 DIAS'],
    ['{{dias}} Dias de repouso', 3, '3 Dias de repouso'],
    ['{{dias}} Dias de repouso', 1, '1 Dia de repouso'],
    ['{{dias}} Dia(s)', 2, '2 Dias'],
    ['afastamento de {{dias}} dias úteis', 1, 'afastamento de 1 dia úteis'],
  ])('%s com %d → %s', (modelo, dias, esperado) => {
    expect(aplicarPlaceholders(modelo, { dias })).toBe(esperado);
  });

  it('não mexe em "dia" que não vem logo depois de {{dias}}', () => {
    expect(
      aplicarPlaceholders('Atendido(a) neste dia. Repouso de {{dias}} dias.', {
        dias: 1,
      }),
    ).toBe('Atendido(a) neste dia. Repouso de 1 dia.');
    expect(aplicarPlaceholders('{{dias}} diaristas', { dias: 1 })).toBe(
      '1 diaristas',
    );
  });

  it('sem valor de dias, o placeholder segue as regras de sempre', () => {
    expect(
      aplicarPlaceholders(
        'período de {{dias}} dias',
        {},
        { manterSemValor: ['dias'] },
      ),
    ).toBe('período de {{dias}} dias');
  });
});

describe('aplicarPlaceholders — caixa da chave', () => {
  it('{{DIAS}} sozinho também é substituído', () => {
    expect(aplicarPlaceholders('Repouso: {{DIAS}}.', { dias: 3 })).toBe(
      'Repouso: 3.',
    );
  });

  it('chave em qualquer caixa vale para todos os placeholders', () => {
    expect(
      aplicarPlaceholders('{{Paciente.Nome}} em {{ DATA }}', {
        'paciente.nome': 'Maria',
        data: '01/10/2026',
      }),
    ).toBe('Maria em 01/10/2026');
  });

  it('a caixa da chave não muda a regra da palavra "dias"', () => {
    expect(aplicarPlaceholders('{{DIAS}} dias', { dias: 1 })).toBe('1 dia');
    expect(aplicarPlaceholders('{{Dias}} DIAS', { dias: 2 })).toBe('2 DIAS');
  });

  it('manterSemValor também ignora a caixa', () => {
    expect(
      aplicarPlaceholders('{{DIAS}} dias', {}, { manterSemValor: ['dias'] }),
    ).toBe('{{DIAS}} dias');
  });

  it('chave do protótipo não é placeholder', () => {
    expect(aplicarPlaceholders('{{constructor}}', { dias: 1 })).toBe(
      '{{constructor}}',
    );
  });
});

describe('aplicarPlaceholdersDetalhado', () => {
  it('informa os placeholders do texto original e os que ficaram sem valor', () => {
    const r = aplicarPlaceholdersDetalhado(
      '{{paciente.nome}}: {{DIAS}} dias desde {{inicio}} {{x}}',
      { 'paciente.nome': 'Maria', dias: 2 },
    );
    expect(r.texto).toBe('Maria: 2 dias desde  {{x}}');
    expect([...r.presentes].sort()).toEqual([
      'dias',
      'inicio',
      'paciente.nome',
    ]);
    expect([...r.semValor]).toEqual(['inicio']);
  });

  it('valor em branco conta como sem valor', () => {
    const r = aplicarPlaceholdersDetalhado('{{dias}}', { dias: '  ' });
    expect(r.semValor.has('dias')).toBe(true);
    expect(r.texto).toBe('');
  });

  it('texto sem placeholder não informa nada', () => {
    const r = aplicarPlaceholdersDetalhado('Retorno em 3 dias', { dias: 3 });
    expect(r.presentes.size).toBe(0);
    expect(r.texto).toBe('Retorno em 3 dias');
  });
});
