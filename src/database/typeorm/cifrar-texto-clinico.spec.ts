import * as crypto from 'crypto';
import {
  COLUNAS_CLINICAS_CIFRADAS,
  COLUNAS_TEXTOS_RAPIDOS_CIFRADAS,
  cifrarTextoClinicoLegado,
  decifrarTextoClinico,
  ExecutarSql,
} from './backfill/cifrar-texto-clinico';
import { decrypt, isEncrypted } from 'src/shared/crypto/encryption.util';
import { EncryptClinicalFreeText1755802310000 } from './migrations/1755802310000-EncryptClinicalFreeText';
import { EncryptClinicalSnippetContent1761000600000 } from './migrations/1761000600000-EncryptClinicalSnippetContent';

type Tabelas = Record<string, Array<Record<string, string | null>>>;

function bancoFalso(tabelas: Tabelas): {
  executar: ExecutarSql;
  updates: number;
} {
  const estado = { updates: 0 };
  const executar: ExecutarSql = (sql, parametros = []) => {
    const tabela = /FROM "(\w+)"|UPDATE "(\w+)"/.exec(sql);
    const nome = (tabela?.[1] ?? tabela?.[2]) as string;
    const coluna = /SET "(\w+)"|"(\w+)" AS "valor"/.exec(sql);
    const col = (coluna?.[1] ?? coluna?.[2]) as string;
    const linhas = tabelas[nome] ?? [];

    if (sql.startsWith('UPDATE')) {
      const [novo, id, antigo] = parametros as string[];
      const linha = linhas.find((l) => l.id === id && l[col] === antigo);
      if (linha) {
        linha[col] = novo;
        estado.updates += 1;
      }
      return Promise.resolve([]);
    }

    const cifrado = sql.includes('NOT LIKE') ? false : true;
    const [lote, depoisDe] = parametros as [number, string | undefined];
    const resultado = linhas
      .filter((l) => l[col] !== null && l[col] !== '')
      .filter((l) => isEncrypted(l[col]) === cifrado)
      .filter((l) => !depoisDe || (l.id as string) > depoisDe)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .slice(0, lote)
      .map((l) => ({ id: l.id, valor: l[col] }));
    return Promise.resolve(resultado);
  };
  return {
    executar,
    get updates() {
      return estado.updates;
    },
  };
}

describe('cifragem do texto clínico legado', () => {
  beforeEach(() => {
    process.env.DB_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  });

  afterEach(() => {
    delete process.env.DB_ENCRYPTION_KEY;
  });

  function massa(): Tabelas {
    return {
      patients: [
        { id: 'p1', medical_notes: 'Alergia a dipirona' },
        { id: 'p2', medical_notes: null },
        { id: 'p3', medical_notes: '' },
      ],
      clinical_records: Array.from({ length: 5 }, (_, i) => ({
        id: `c${i}`,
        anamnesis: `Queixa ${i}`,
        physical_exam: null,
        diagnosis: 'Lombalgia',
        conduct: 'Repouso',
      })),
    };
  }

  it('cobre medical_notes e as seções de texto da ficha', () => {
    expect(COLUNAS_CLINICAS_CIFRADAS).toEqual(
      expect.arrayContaining([
        { tabela: 'patients', coluna: 'medical_notes' },
        { tabela: 'clinical_records', coluna: 'anamnesis' },
        { tabela: 'clinical_records', coluna: 'physical_exam' },
        { tabela: 'clinical_records', coluna: 'diagnosis' },
        { tabela: 'clinical_records', coluna: 'conduct' },
      ]),
    );
  });

  it('cifra em lotes, preserva nulos/vazios e é idempotente', async () => {
    const tabelas = massa();
    const banco = bancoFalso(tabelas);

    const total = await cifrarTextoClinicoLegado(banco.executar, 2);

    expect(total).toBe(1 + 5 * 3);
    expect(isEncrypted(tabelas.patients[0].medical_notes)).toBe(true);
    expect(decrypt(tabelas.patients[0].medical_notes as string)).toBe(
      'Alergia a dipirona',
    );
    expect(tabelas.patients[1].medical_notes).toBeNull();
    expect(tabelas.patients[2].medical_notes).toBe('');
    expect(tabelas.clinical_records[4].physical_exam).toBeNull();

    const segunda = await cifrarTextoClinicoLegado(banco.executar, 2);
    expect(segunda).toBe(0);
  });

  it('down devolve o texto em claro', async () => {
    const tabelas = massa();
    const banco = bancoFalso(tabelas);
    await cifrarTextoClinicoLegado(banco.executar);

    await decifrarTextoClinico(banco.executar);

    expect(tabelas.clinical_records[0].anamnesis).toBe('Queixa 0');
    expect(tabelas.patients[0].medical_notes).toBe('Alergia a dipirona');
  });

  it('migration não faz nada sem DB_ENCRYPTION_KEY', async () => {
    delete process.env.DB_ENCRYPTION_KEY;
    const query = jest.fn();

    await new EncryptClinicalFreeText1755802310000().up({ query } as never);

    expect(query).not.toHaveBeenCalled();
  });

  it('migration cifra pelo queryRunner quando há chave', async () => {
    const tabelas = massa();
    const banco = bancoFalso(tabelas);

    await new EncryptClinicalFreeText1755802310000().up({
      query: banco.executar,
    } as never);

    expect(isEncrypted(tabelas.clinical_records[2].conduct)).toBe(true);
  });

  describe('textos rápidos', () => {
    function textos(): Tabelas {
      return {
        clinical_snippets: [
          { id: 's1', content: '<p>Paciente refere dor no joelho.</p>' },
          { id: 's2', content: '<p>Bom estado geral.</p>' },
        ],
        clinical_records: [{ id: 'c1', anamnesis: 'Queixa' }],
      };
    }

    it('cobre o conteúdo dos textos rápidos', () => {
      expect(COLUNAS_TEXTOS_RAPIDOS_CIFRADAS).toEqual([
        { tabela: 'clinical_snippets', coluna: 'content' },
      ]);
    });

    it('migration cifra só os textos rápidos e o down devolve em claro', async () => {
      const tabelas = textos();
      const banco = bancoFalso(tabelas);
      const migration = new EncryptClinicalSnippetContent1761000600000();

      await migration.up({ query: banco.executar } as never);

      expect(isEncrypted(tabelas.clinical_snippets[0].content)).toBe(true);
      expect(decrypt(tabelas.clinical_snippets[1].content as string)).toBe(
        '<p>Bom estado geral.</p>',
      );
      expect(tabelas.clinical_records[0].anamnesis).toBe('Queixa');

      await migration.down({ query: banco.executar } as never);

      expect(tabelas.clinical_snippets[0].content).toBe(
        '<p>Paciente refere dor no joelho.</p>',
      );
    });

    it('migration não faz nada sem DB_ENCRYPTION_KEY', async () => {
      delete process.env.DB_ENCRYPTION_KEY;
      const query = jest.fn();

      await new EncryptClinicalSnippetContent1761000600000().up({
        query,
      } as never);

      expect(query).not.toHaveBeenCalled();
    });
  });
});
