import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { ExportFeegow, PASTA_TABELAS } from './export';

describe('ExportFeegow.arquivo', () => {
  const exp = new ExportFeegow('/export');

  it('monta o caminho dentro de Client/<pasta>', () => {
    expect(exp.arquivo('Perfil')).toBe(resolve('/export/Client/Perfil'));
    expect(exp.arquivo('Arquivos', 'laudo.pdf')).toBe(
      resolve('/export/Client/Arquivos/laudo.pdf'),
    );
  });

  it('nome do CSV que sai da pasta devolve null', () => {
    expect(exp.arquivo('Arquivos', '../../../etc/passwd')).toBeNull();
    expect(exp.arquivo('Arquivos', '../Perfil/abc.png')).toBeNull();
    expect(exp.arquivo('Arquivos', '/etc/passwd')).toBeNull();
    expect(exp.arquivo('Arquivos', '.')).toBeNull();
    expect(exp.arquivo('Arquivos', 'a\0.pdf')).toBeNull();
  });

  it('sem pasta (fixture em memória) não há arquivo', () => {
    expect(new ExportFeegow(null).arquivo('Perfil', 'a.png')).toBeNull();
  });
});

describe('ExportFeegow.tabela', () => {
  it('linha malformada fica de fora e vai para drenarProblemas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'export-'));
    mkdirSync(join(dir, PASTA_TABELAS), { recursive: true });
    writeFileSync(
      join(dir, PASTA_TABELAS, 'pacientes.csv'),
      'id,nome\n1,Ana\n2,Bia,extra\n',
    );
    const exp = new ExportFeegow(dir);

    expect(exp.tabela('pacientes')).toEqual([{ id: '1', nome: 'Ana' }]);
    expect(exp.drenarProblemas()).toEqual([
      expect.objectContaining({ tabela: 'pacientes', linha: 3 }),
    ]);
    expect(exp.drenarProblemas()).toEqual([]);
  });
});
