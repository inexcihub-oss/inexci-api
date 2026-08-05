/**
 * Proteção do banco nos testes e2e.
 *
 * A suíte e2e trunca **todas** as tabelas a cada teste. Como o `.env` do
 * projeto aponta para o banco de desenvolvimento, rodar `yarn test:e2e` sem
 * essa proteção apaga o banco de trabalho de quem estiver usando a máquina.
 *
 * Vive em `src/` (e não em `test/`) para ser coberto por `yarn test`: assim a
 * regressão aparece para quem nunca executa os e2e.
 */

/**
 * Tabelas que o TRUNCATE dos e2e **não** pode tocar.
 *
 * `migrations` é óbvio. `subscription_plans` é catálogo de plataforma semeado
 * pela própria migration (`CreateBilling`), não dado de tenant: truncá-la deixa
 * `findTrialDefault()` sem plano, o trial do `/auth/register` falha em silêncio
 * (o erro é engolido por um try/catch) e todo `POST /surgery-requests/:id/send`
 * passa a responder 404 "Assinatura não encontrada" — sintoma bem distante da
 * causa. Nada repõe essa tabela entre os testes.
 */
export const TABELAS_PRESERVADAS_NO_TRUNCATE = [
  'migrations',
  'subscription_plans',
] as const;

/**
 * SQL que lista as tabelas a truncar, já excluindo as preservadas.
 */
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

/** Nome do único banco que os e2e podem destruir. */
export function nomeDoBancoDeTeste(): string {
  return process.env.TEST_DB_NAME ?? 'inexci_test';
}

/**
 * Troca o nome do banco na connection string, preservando usuário, senha,
 * host, porta e query string.
 */
export function comBancoDeTeste(url: string, nome = nomeDoBancoDeTeste()) {
  try {
    const parsed = new URL(url);
    parsed.pathname = `/${nome}`;
    return parsed.toString();
  } catch {
    return url.replace(/\/[^/?]+(\?|$)/, `/${nome}$1`);
  }
}

/**
 * Rede de segurança final, checada contra o banco **de fato conectado**: mesmo
 * que alguém reintroduza um `DATABASE_URL` de desenvolvimento (via `.env.test`,
 * CI mal configurado ou export manual), o TRUNCATE só roda se o nome bater.
 * Falhar ruidosamente é infinitamente melhor do que apagar o banco de trabalho
 * em silêncio.
 */
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
