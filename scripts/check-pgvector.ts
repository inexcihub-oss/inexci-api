import 'dotenv/config';
import { Client } from 'pg';

/**
 * Verifica antes do deploy se o Postgres tem a extensão `pgvector` disponível
 * (e idealmente já instalada). Falha cedo com mensagem objetiva quando o
 * banco não está apto a hospedar o RAG.
 *
 * Uso:
 *   yarn predeploy        (rodado automaticamente antes do deploy)
 *   yarn check:pgvector   (manual)
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      '[check-pgvector] DATABASE_URL não definido. Configure o `.env` antes do deploy.',
    );
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();

    const available = await client.query(
      `SELECT 1 FROM pg_available_extensions WHERE name = 'vector' LIMIT 1;`,
    );
    if (available.rowCount === 0) {
      console.error(
        '[check-pgvector] FALHA: extensão `vector` (pgvector) não disponível neste Postgres.\n' +
          '  Use a imagem `pgvector/pgvector:pg16` ou instale a extensão antes de rodar as migrations.',
      );
      process.exit(2);
    }

    const installed = await client.query(
      `SELECT extversion FROM pg_extension WHERE extname = 'vector' LIMIT 1;`,
    );
    if (installed.rowCount === 0) {
      console.warn(
        '[check-pgvector] AVISO: extensão disponível mas ainda não instalada. A migration cria via `CREATE EXTENSION vector`.',
      );
    } else {
      console.log(
        `[check-pgvector] OK: pgvector ${installed.rows[0].extversion} instalado.`,
      );
    }
  } catch (error) {
    console.error(
      `[check-pgvector] Erro ao validar pgvector: ${(error as Error).message}`,
    );
    process.exit(3);
  } finally {
    await client.end().catch(() => undefined);
  }
}

main();
