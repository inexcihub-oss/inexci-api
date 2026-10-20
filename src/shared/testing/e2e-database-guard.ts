export const TABELAS_PRESERVADAS_NO_TRUNCATE = [
  'migrations',
  'subscription_plans',
] as const;

export function sqlTabelasParaTruncar(): string {
  const preservadas = TABELAS_PRESERVADAS_NO_TRUNCATE.map((t) => `'${t}'`).join(
    ', ',
  );
  return `
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename NOT IN (${preservadas})
    `;
}

export function nomeDoBancoDeTeste(): string {
  return process.env.TEST_DB_NAME ?? 'inexci_test';
}

export function comBancoDeTeste(url: string, nome = nomeDoBancoDeTeste()) {
  try {
    const parsed = new URL(url);
    parsed.pathname = `/${nome}`;
    return parsed.toString();
  } catch {
    return url.replace(/\/[^/?]+(\?|$)/, `/${nome}$1`);
  }
}

export async function assertBancoDeTeste(consulta: {
  query: (sql: string) => Promise<{ current_database: string }[]>;
}): Promise<void> {
  const esperado = nomeDoBancoDeTeste();
  const linhas = await consulta.query('SELECT current_database()');
  const atual = linhas?.[0]?.current_database;

  if (atual !== esperado) {
    throw new Error(
      `[e2e] Recusando limpar o banco "${atual}": os testes e2e só podem ` +
        `rodar contra "${esperado}". Rode \`yarn test:e2e:prepare\` para ` +
        `criá-lo e migrá-lo (ou ajuste TEST_DB_NAME).`,
    );
  }
}
