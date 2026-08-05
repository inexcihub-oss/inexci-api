/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Prepara o banco dedicado aos testes e2e.
 *
 * Existe porque a suíte e2e trunca todas as tabelas a cada teste: apontá-la
 * para o banco de desenvolvimento apaga o trabalho de quem estiver na máquina.
 * Este script cria (se preciso) o banco de teste, habilita o `pgvector` e roda
 * as migrations nele — sem tocar no banco de dev.
 *
 * Uso: `yarn test:e2e:prepare` (o `pretest:e2e` chama automaticamente).
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');

const TEST_DB_NAME = process.env.TEST_DB_NAME || 'inexci_test';

function carregarEnv() {
  const fs = require('node:fs');
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  for (const linha of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, chave, valorBruto] = m;
    if (process.env[chave] !== undefined) continue;
    process.env[chave] = valorBruto.replace(/^["']|["']$/g, '');
  }
}

async function main() {
  carregarEnv();

  const base =
    process.env.DATABASE_URL ||
    'postgresql://inexci_user:inexci_pass@localhost:5432/inexci';

  const url = new URL(base);
  const bancoDev = url.pathname.replace(/^\//, '');
  if (bancoDev === TEST_DB_NAME) {
    throw new Error(
      `DATABASE_URL já aponta para "${TEST_DB_NAME}" — configure-o para o ` +
        'banco de desenvolvimento; este script deriva o de teste sozinho.',
    );
  }

  // Conecta no `postgres` para poder criar o banco de teste.
  const admin = new URL(base);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  const existe = await client.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [TEST_DB_NAME],
  );
  if (existe.rowCount === 0) {
    await client.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
    console.log(`[e2e] banco "${TEST_DB_NAME}" criado`);
  } else {
    console.log(`[e2e] banco "${TEST_DB_NAME}" já existe`);
  }
  await client.end();

  const alvo = new URL(base);
  alvo.pathname = `/${TEST_DB_NAME}`;

  const cliente = new Client({ connectionString: alvo.toString() });
  await cliente.connect();
  await cliente.query('CREATE EXTENSION IF NOT EXISTS vector');
  await cliente.end();

  console.log('[e2e] rodando migrations no banco de teste...');
  execFileSync(
    process.execPath,
    [
      '-r',
      'tsconfig-paths/register',
      'node_modules/typeorm/cli-ts-node-commonjs.js',
      'migration:run',
      '-d',
      'src/database/typeorm/data-source.ts',
    ],
    {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: alvo.toString() },
    },
  );
  console.log(`[e2e] banco "${TEST_DB_NAME}" pronto`);
}

main().catch((erro) => {
  console.error('[e2e] falha ao preparar o banco de teste:', erro.message);
  process.exit(1);
});
