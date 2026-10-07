import {
  csvParaObjetos,
  limparCampo,
  parseCsv,
  parseCsvComLinhas,
  ProblemaCsv,
} from './csv';

describe('parseCsv', () => {
  it('separa campos e linhas', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('respeita vírgula, aspas duplicadas e quebra de linha entre aspas', () => {
    expect(parseCsv('a,b\n"x, y","<p>1</p>\n<p>""2""</p>"\n')).toEqual([
      ['a', 'b'],
      ['x, y', '<p>1</p>\n<p>"2"</p>'],
    ]);
  });

  it('aceita CRLF e última linha sem quebra', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('aspas sem fechamento até o fim do arquivo é erro, com tabela e linha', () => {
    expect(() => parseCsv('a,b\n1,2\n3,"sem fim\n4,5\n', 'pacientes')).toThrow(
      /pacientes.*linha 3/,
    );
  });

  it('ignora o BOM do UTF-8', () => {
    expect(parseCsv('﻿a\n1\n')[0]).toEqual(['a']);
  });
});

describe('limparCampo', () => {
  it('vazio vira null', () => {
    expect(limparCampo('')).toBeNull();
    expect(limparCampo('   ')).toBeNull();
  });

  it("remove o artefato '-1 do export", () => {
    expect(limparCampo("'-1")).toBe('-1');
    expect(limparCampo("'-3")).toBe('-3');
  });

  it('mantém aspa simples que não é o artefato', () => {
    expect(limparCampo("D'Ávila")).toBe("D'Ávila");
  });
});

describe('csvParaObjetos', () => {
  it('monta objetos pelo cabeçalho', () => {
    expect(csvParaObjetos("id,sys_active,nome\n1,'-1,\n")).toEqual([
      { id: '1', sys_active: '-1', nome: null },
    ]);
  });

  it('linha com número de campos diferente fica de fora e é anotada', () => {
    const problemas: ProblemaCsv[] = [];
    expect(
      csvParaObjetos('a,b\n1\n2,3\n"x\ny",4\n5,6,7\n', 'agenda', problemas),
    ).toEqual([
      { a: '2', b: '3' },
      { a: 'x\ny', b: '4' },
    ]);
    expect(problemas).toEqual([
      {
        tabela: 'agenda',
        linha: 2,
        motivo: expect.stringContaining('1 campos'),
      },
      {
        tabela: 'agenda',
        linha: 6,
        motivo: expect.stringContaining('3 campos'),
      },
    ]);
  });

  it('sem onde anotar, linha malformada é erro (nunca some calada)', () => {
    expect(() => csvParaObjetos('a,b\n1\n', 'agenda')).toThrow(
      /agenda, linha 2/,
    );
  });

  it('linha em branco é ignorada sem problema', () => {
    expect(csvParaObjetos('a,b\n1,2\n\n3,4\n')).toHaveLength(2);
  });
});

describe('parseCsvComLinhas', () => {
  it('conta a linha física de início, com CRLF e quebra entre aspas', () => {
    expect(parseCsvComLinhas('a\r\n"x\r\ny"\r\nz').map((r) => r.linha)).toEqual(
      [1, 2, 4],
    );
  });
});
