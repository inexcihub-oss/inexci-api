import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
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

  describe('com arquivos de verdade', () => {
    const raiz = realpathSync(mkdtempSync(join(tmpdir(), 'export-arq-')));
    const fora = join(raiz, 'segredo.env');
    const arquivos = join(raiz, 'export', 'Client', 'Arquivos');
    mkdirSync(arquivos, { recursive: true });
    mkdirSync(join(arquivos, 'sub'));
    writeFileSync(fora, 'JWT_SECRET=x');
    writeFileSync(join(arquivos, 'laudo.pdf'), '%PDF');
    symlinkSync(fora, join(arquivos, 'exame.pdf'));
    symlinkSync(join(raiz, 'nao-existe'), join(arquivos, 'quebrado.pdf'));
    symlinkSync(join(arquivos, 'laudo.pdf'), join(arquivos, 'atalho.pdf'));
    const real = new ExportFeegow(join(raiz, 'export'));

    it('arquivo comum dentro da pasta passa', () => {
      expect(real.arquivo('Arquivos', 'laudo.pdf')).toBe(
        join(arquivos, 'laudo.pdf'),
      );
    });

    it('symlink para fora do export devolve null', () => {
      expect(real.arquivo('Arquivos', 'exame.pdf')).toBeNull();
    });

    it('symlink para dentro da pasta resolve no arquivo real', () => {
      expect(real.arquivo('Arquivos', 'atalho.pdf')).toBe(
        join(arquivos, 'laudo.pdf'),
      );
    });

    it('diretório não é arquivo', () => {
      expect(real.arquivo('Arquivos', 'sub')).toBeNull();
    });

    it('inexistente ou symlink quebrado devolve o caminho (vira "ausente")', () => {
      expect(real.arquivo('Arquivos', 'nada.pdf')).toBe(
        join(arquivos, 'nada.pdf'),
      );
      expect(real.arquivo('Arquivos', 'quebrado.pdf')).toBe(
        join(arquivos, 'quebrado.pdf'),
      );
    });
  });

  describe('com a própria pasta-base symlinkada', () => {
    const raiz = realpathSync(mkdtempSync(join(tmpdir(), 'export-base-')));
    const fora = join(raiz, 'fora');
    mkdirSync(fora);
    writeFileSync(join(fora, 'segredo.env'), 'JWT_SECRET=x');
    const client = join(raiz, 'export', 'Client');
    mkdirSync(client, { recursive: true });
    mkdirSync(join(raiz, 'export', 'outra'));
    writeFileSync(join(raiz, 'export', 'outra', 'laudo.pdf'), '%PDF');
    // Client/Arquivos -> fora do export; Client/Perfil -> dentro do export.
    symlinkSync(fora, join(client, 'Arquivos'));
    symlinkSync(join(raiz, 'export', 'outra'), join(client, 'Perfil'));
    const exp = new ExportFeegow(join(raiz, 'export'));

    it('base que aponta para fora do export devolve null', () => {
      expect(exp.arquivo('Arquivos', 'segredo.env')).toBeNull();
    });

    it('base que aponta para dentro do export resolve', () => {
      expect(exp.arquivo('Perfil', 'laudo.pdf')).toBe(
        join(raiz, 'export', 'outra', 'laudo.pdf'),
      );
    });
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

  it('nome com separador ou .. (modelo_id forjado) não sai do export', () => {
    const dir = mkdtempSync(join(tmpdir(), 'export-'));
    mkdirSync(join(dir, PASTA_TABELAS), { recursive: true });
    writeFileSync(join(dir, 'fora.csv'), 'id\n1\n');
    const exp = new ExportFeegow(dir);

    expect(exp.tabela('../../fora')).toEqual([]);
    expect(exp.tabela('_/../../../fora')).toEqual([]);
    expect(exp.tabela('_..\\fora')).toEqual([]);
  });

  it('CSV symlinkado para fora do export não é lido', () => {
    const raiz = realpathSync(mkdtempSync(join(tmpdir(), 'export-csv-')));
    const dir = join(raiz, 'export');
    mkdirSync(join(dir, PASTA_TABELAS), { recursive: true });
    writeFileSync(join(raiz, 'segredo.csv'), 'id,nome\n1,Segredo\n');
    writeFileSync(join(dir, 'interno.csv'), 'id,nome\n2,Bia\n');
    symlinkSync(
      join(raiz, 'segredo.csv'),
      join(dir, PASTA_TABELAS, 'pacientes.csv'),
    );
    symlinkSync(
      join(dir, 'interno.csv'),
      join(dir, PASTA_TABELAS, 'convenios.csv'),
    );
    const exp = new ExportFeegow(dir);

    expect(exp.tabela('pacientes')).toEqual([]);
    expect(exp.drenarProblemas()).toEqual([
      expect.objectContaining({ tabela: 'pacientes', linha: 0 }),
    ]);
    expect(exp.tabela('convenios')).toEqual([{ id: '2', nome: 'Bia' }]);
  });

  it('pasta de tabelas symlinkada para fora do export não é lida', () => {
    const raiz = realpathSync(mkdtempSync(join(tmpdir(), 'export-csvdir-')));
    const dir = join(raiz, 'export');
    const fora = join(raiz, 'fora');
    mkdirSync(fora);
    writeFileSync(join(fora, 'pacientes.csv'), 'id,nome\n1,Segredo\n');
    mkdirSync(join(dir, 'database'), { recursive: true });
    symlinkSync(fora, join(dir, PASTA_TABELAS));

    expect(new ExportFeegow(dir).tabela('pacientes')).toEqual([]);
  });
});
