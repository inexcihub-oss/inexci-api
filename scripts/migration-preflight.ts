import 'dotenv/config';
import { Client } from 'pg';
import { rodarPreflight } from '../src/database/typeorm/preflight/preflight';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      '[preflight] DATABASE_URL não definido. Configure o `.env` antes do deploy.',
    );
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();

    const resultado = await rodarPreflight({
      aplicadas: async () => {
        const existe = await client.query(
          `SELECT to_regclass('public.migrations') AS tabela`,
        );
        if (!existe.rows[0]?.tabela) return [];
        const nomes = await client.query(`SELECT name FROM migrations`);
        return nomes.rows.map((linha: { name: string }) => linha.name);
      },
      consultar: async (sql) => (await client.query(sql)).rows,
    });

    for (const nome of resultado.puladas) {
      console.log(`[preflight] ${nome}: já aplicada, verificação dispensada.`);
    }

    for (const adiada of resultado.adiadas) {
      console.log(`[preflight] adiada para a migration: ${adiada}`);
    }

    if (resultado.aprovado) {
      console.log(
        `[preflight] OK: ${resultado.verificadas.length} verificação(ões) pendente(s) sem conflito.`,
      );
      return;
    }

    console.error('\n[preflight] DEPLOY BLOQUEADO — conflito de dado:\n');
    for (const diagnostico of resultado.diagnosticos) {
      console.error(`${diagnostico}\n`);
    }
    process.exit(2);
  } catch (erro) {
    console.error(`[preflight] Erro ao verificar: ${(erro as Error).message}`);
    process.exit(3);
  } finally {
    await client.end().catch(() => undefined);
  }
}

void main();
