import {
  cpfValido,
  dataHoraCompleta,
  decodificarEntidadesHtml,
  repararNomeCortado,
  dataHoraSaoPaulo,
  normalizarCep,
  normalizarCpf,
  normalizarData,
  normalizarEmail,
  normalizarSexo,
  normalizarTelefone,
  normalizarTexto,
  normalizarUf,
  telefonesDistintos,
} from './normalizers';

describe('normalizadores', () => {
  describe('CPF', () => {
    it('aceita CPF válido com ou sem máscara', () => {
      expect(normalizarCpf('529.982.247-25')).toBe('52998224725');
      expect(normalizarCpf('52998224725')).toBe('52998224725');
    });

    it('recupera o zero à esquerda só de número cru com 10 dígitos', () => {
      expect(cpfValido('01234567890')).toBe(true);
      expect(normalizarCpf('1234567890')).toBe('01234567890');
      expect(normalizarCpf(' 1234567890 ')).toBe('01234567890');
    });

    it('não completa valor curto mascarado nem com 9 dígitos (RG no campo)', () => {
      // 001.234.567-90 sem os dois zeros seria válido: não é chute que se faça.
      expect(cpfValido('00123456790')).toBe(false);
      expect(normalizarCpf('123456789')).toBeNull();
      expect(normalizarCpf('12.345.678-90')).toBeNull();
      expect(normalizarCpf('123.456.789-0')).toBeNull();
    });

    it('recusa dígito verificador errado, repetido e telefone no campo', () => {
      expect(normalizarCpf('52998224726')).toBeNull();
      expect(normalizarCpf('11111111111')).toBeNull();
      expect(normalizarCpf('(24) 999998888')).toBeNull();
      expect(normalizarCpf(null)).toBeNull();
    });
  });

  describe('telefone', () => {
    it('normaliza celular e fixo com DDD', () => {
      expect(normalizarTelefone('(24) 99999-8888')).toBe('24999998888');
      expect(normalizarTelefone('2422334455')).toBe('2422334455');
    });

    it('tira o 55 do país', () => {
      expect(normalizarTelefone('+55 24 99999-8888')).toBe('24999998888');
    });

    it('recusa e-mail digitado no campo e número sem DDD', () => {
      expect(normalizarTelefone('FULANO@YAHOO.COM.BR')).toBeNull();
      expect(normalizarTelefone('99998888')).toBeNull();
    });

    it('telefonesDistintos mantém a ordem e tira repetidos e inválidos', () => {
      expect(
        telefonesDistintos([
          '24999998888',
          null,
          '(24) 99999-8888',
          'x',
          '2422334455',
        ]),
      ).toEqual(['24999998888', '2422334455']);
    });
  });

  it('CEP', () => {
    expect(normalizarCep('25650000')).toBe('25650-000');
    expect(normalizarCep('2565000')).toBe('02565-000');
    expect(normalizarCep('123')).toBeNull();
  });

  it('UF', () => {
    expect(normalizarUf('rj')).toBe('RJ');
    expect(normalizarUf('Selecione')).toBeNull();
  });

  it('sexo', () => {
    expect(normalizarSexo('1')).toBe('M');
    expect(normalizarSexo('2')).toBe('F');
    expect(normalizarSexo('0')).toBeNull();
    expect(normalizarSexo('3')).toBeNull();
  });

  it('e-mail', () => {
    expect(normalizarEmail(' Ana@Clinica.com ')).toBe('ana@clinica.com');
    expect(normalizarEmail('ana@')).toBeNull();
  });

  it('texto', () => {
    expect(normalizarTexto('  Maria   da  Silva ', 100)).toBe('Maria da Silva');
    expect(normalizarTexto('abcdef', 3)).toBe('abc');
    expect(normalizarTexto('   ', 10)).toBeNull();
  });

  describe('datas', () => {
    it('ISO e BR', () => {
      expect(normalizarData('1985-02-11')).toBe('1985-02-11');
      expect(normalizarData('11/02/1985 10:00:00')).toBe('1985-02-11');
    });

    it('recusa 0000-00-00 e data impossível', () => {
      expect(normalizarData('0000-00-00')).toBeNull();
      expect(normalizarData('2023-02-30')).toBeNull();
    });

    it('data e hora de São Paulo viram UTC (+3h)', () => {
      expect(dataHoraSaoPaulo('2026-01-15', '09:00:00')?.toISOString()).toBe(
        '2026-01-15T12:00:00.000Z',
      );
      expect(dataHoraCompleta('2025-05-09 11:42:47')?.toISOString()).toBe(
        '2025-05-09T14:42:47.000Z',
      );
    });

    it('sem hora vira meia-noite local', () => {
      expect(dataHoraSaoPaulo('2026-01-15')?.toISOString()).toBe(
        '2026-01-15T03:00:00.000Z',
      );
      expect(dataHoraSaoPaulo('2026-01-15', '')?.toISOString()).toBe(
        '2026-01-15T03:00:00.000Z',
      );
    });

    it('aceita hora com 1 dígito', () => {
      expect(dataHoraSaoPaulo('2026-01-15', '9:00')?.toISOString()).toBe(
        '2026-01-15T12:00:00.000Z',
      );
      expect(dataHoraCompleta('2026-01-15 9:05:00')?.toISOString()).toBe(
        '2026-01-15T12:05:00.000Z',
      );
    });

    it('hora presente mas ilegível vira null, não meia-noite', () => {
      expect(dataHoraSaoPaulo('2026-01-15', '9h')).toBeNull();
      expect(dataHoraSaoPaulo('2026-01-15', '25:00')).toBeNull();
      expect(dataHoraSaoPaulo('2026-01-15', '10:75')).toBeNull();
      expect(dataHoraCompleta('2026-01-15 xx')).toBeNull();
    });

    it('usa o horário de verão de antes de 2019 (-02:00)', () => {
      // Verão 2017/2018: 15/10/2017 a 18/02/2018.
      expect(dataHoraSaoPaulo('2018-01-15', '10:00')?.toISOString()).toBe(
        '2018-01-15T12:00:00.000Z',
      );
      expect(dataHoraSaoPaulo('2018-06-15', '10:00')?.toISOString()).toBe(
        '2018-06-15T13:00:00.000Z',
      );
    });

    it('meia-noite que não existiu (início do verão) cai em 01:00', () => {
      // 04/11/2018: o relógio pulou de 00:00 para 01:00 (-02:00).
      expect(dataHoraSaoPaulo('2018-11-04')?.toISOString()).toBe(
        '2018-11-04T03:00:00.000Z',
      );
    });
  });
});

describe('decodificarEntidadesHtml', () => {
  it('monta letras acentuadas e cedilha', () => {
    expect(
      decodificarEntidadesHtml(
        'Altera&ccedil;&atilde;o de hor&aacute;rio &Eacute; &ecirc;',
      ),
    ).toBe('Alteração de horário É ê');
  });

  it('entidades nomeadas comuns e numéricas', () => {
    expect(decodificarEntidadesHtml('a &amp; b&nbsp;&#231;&#xE3;')).toBe(
      'a & b çã',
    );
  });

  it('código numérico fora do Unicode ou inválido fica como está', () => {
    expect(decodificarEntidadesHtml('a&#99999999;b &#x110000; &#0;')).toBe(
      'a&#99999999;b &#x110000; &#0;',
    );
    expect(decodificarEntidadesHtml('&#xD800;')).toBe('&#xD800;');
  });

  it('entidade desconhecida fica como está', () => {
    expect(decodificarEntidadesHtml('&foo; &xacute')).toBe('&foo; &xacute');
  });
});

describe('repararNomeCortado', () => {
  it('troca a entidade cortada pelo caractere e marca o corte', () => {
    expect(repararNomeCortado('JOS&EACUTE')).toEqual({
      nome: 'JOSÉ',
      cortado: true,
    });
    expect(repararNomeCortado('MARCILENE GON&CCEDIL')).toEqual({
      nome: 'MARCILENE GONÇ',
      cortado: true,
    });
    expect(repararNomeCortado('THIAGO GUIMAR&ATILDE')).toEqual({
      nome: 'THIAGO GUIMARÃ',
      cortado: true,
    });
    expect(repararNomeCortado('RICARDO Q&PERIOD')).toEqual({
      nome: 'RICARDO Q.',
      cortado: true,
    });
    expect(repararNomeCortado('TERESA D&APOS')).toEqual({
      nome: "TERESA D'",
      cortado: true,
    });
  });

  it('nome normal passa intacto; entidade desconhecida fica', () => {
    expect(repararNomeCortado('MARIA SILVA')).toEqual({
      nome: 'MARIA SILVA',
      cortado: false,
    });
    expect(repararNomeCortado('ANA &XYZ')).toEqual({
      nome: 'ANA &XYZ',
      cortado: true,
    });
  });
});
