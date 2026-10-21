import { bytesDoCsv, contentDispositionCsv, gerarCsv, valorCsv } from './csv';

describe('csv', () => {
  it('formata valor monetário com vírgula decimal', () => {
    expect(valorCsv('1234.5')).toBe('1234,50');
    expect(valorCsv('-0.04')).toBe('-0,04');
    expect(valorCsv(null)).toBe('0,00');
  });

  it('gera linhas separadas por ponto e vírgula com cabeçalho', () => {
    expect(gerarCsv(['Forma', 'Valor'], [['PIX', valorCsv('300.00')]])).toBe(
      'Forma;Valor\r\nPIX;300,00\r\n',
    );
  });

  it('escapa aspas, separador e quebra de linha', () => {
    expect(gerarCsv(['A'], [['x;y'], ['diz "oi"'], [null]])).toBe(
      'A\r\n"x;y"\r\n"diz ""oi"""\r\n\r\n',
    );
  });

  it('neutraliza células de texto que começam como fórmula', () => {
    expect(
      gerarCsv(
        ['A'],
        [
          ['=HYPERLINK("http://x")'],
          ['+1+1'],
          ['-2+3'],
          ['@SUM(A1)'],
          ['\tcmd'],
          ['\rcmd'],
          ['Maria'],
        ],
      ),
    ).toBe(
      'A\r\n' +
        '"\'=HYPERLINK(""http://x"")"\r\n' +
        "'+1+1\r\n" +
        "'-2+3\r\n" +
        "'@SUM(A1)\r\n" +
        "'\tcmd\r\n" +
        '"\'\rcmd"\r\n' +
        'Maria\r\n',
    );
  });

  it('não prefixa valores monetários negativos nem números', () => {
    expect(
      gerarCsv(
        ['V', 'N'],
        [
          [valorCsv('-50.00'), -3],
          [valorCsv('-0.04'), 7],
        ],
      ),
    ).toBe('V;N\r\n-50,00;-3\r\n-0,04;7\r\n');
  });

  it('sanitiza o nome do arquivo', () => {
    expect(contentDispositionCsv('recebimentos 2026/01.csv')).toBe(
      'attachment; filename="recebimentos_2026_01.csv"',
    );
  });

  it('o arquivo começa com o BOM UTF-8 para o Excel ler os acentos', () => {
    const bytes = bytesDoCsv('Descrição;Líquido\r\n');
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString('utf-8')).toBe('Descrição;Líquido\r\n');
  });
});
