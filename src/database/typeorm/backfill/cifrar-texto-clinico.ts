import {
  decrypt,
  encrypt,
  ENCRYPTED_PREFIX,
} from '../../../shared/crypto/encryption.util';

export interface ColunaCifrada {
  tabela: string;
  coluna: string;
}

export const COLUNAS_CLINICAS_CIFRADAS: readonly ColunaCifrada[] = [
  { tabela: 'patients', coluna: 'medical_notes' },
  { tabela: 'clinical_records', coluna: 'anamnesis' },
  { tabela: 'clinical_records', coluna: 'physical_exam' },
  { tabela: 'clinical_records', coluna: 'diagnosis' },
  { tabela: 'clinical_records', coluna: 'conduct' },
];

export type ExecutarSql = (
  sql: string,
  parametros?: unknown[],
) => Promise<unknown>;

const LOTE_PADRAO = 200;

async function percorrer(
  executar: ExecutarSql,
  alvo: ColunaCifrada,
  filtro: string,
  transformar: (valor: string) => string,
  lote: number,
): Promise<number> {
  const { tabela, coluna } = alvo;
  let ultimoId: string | null = null;
  let alteradas = 0;

  for (;;) {
    const linhas = (await executar(
      `SELECT "id", "${coluna}" AS "valor" FROM "${tabela}"
        WHERE "${coluna}" IS NOT NULL AND "${coluna}" <> '' AND ${filtro}
          ${ultimoId ? 'AND "id" > $2' : ''}
        ORDER BY "id" ASC
        LIMIT $1`,
      ultimoId ? [lote, ultimoId] : [lote],
    )) as Array<{ id: string; valor: string }>;

    if (linhas.length === 0) break;

    for (const linha of linhas) {
      const novo = transformar(linha.valor);
      if (novo === linha.valor) continue;
      await executar(
        `UPDATE "${tabela}" SET "${coluna}" = $1 WHERE "id" = $2 AND "${coluna}" = $3`,
        [novo, linha.id, linha.valor],
      );
      alteradas += 1;
    }

    ultimoId = linhas[linhas.length - 1].id;
    if (linhas.length < lote) break;
  }

  return alteradas;
}

export async function cifrarTextoClinicoLegado(
  executar: ExecutarSql,
  lote = LOTE_PADRAO,
): Promise<number> {
  let total = 0;
  for (const alvo of COLUNAS_CLINICAS_CIFRADAS) {
    total += await percorrer(
      executar,
      alvo,
      `"${alvo.coluna}" NOT LIKE '${ENCRYPTED_PREFIX}%'`,
      encrypt,
      lote,
    );
  }
  return total;
}

export async function decifrarTextoClinico(
  executar: ExecutarSql,
  lote = LOTE_PADRAO,
): Promise<number> {
  let total = 0;
  for (const alvo of COLUNAS_CLINICAS_CIFRADAS) {
    total += await percorrer(
      executar,
      alvo,
      `"${alvo.coluna}" LIKE '${ENCRYPTED_PREFIX}%'`,
      decrypt,
      lote,
    );
  }
  return total;
}
