import { csvParaObjetos, limparCampo, parseCsv } from './csv';

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

  it('linha com menos colunas completa com null', () => {
    expect(csvParaObjetos('a,b\n1\n')).toEqual([{ a: '1', b: null }]);
  });
});
