import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';
import { getQueueToken } from '@nestjs/bull';
import { Queue } from 'bull';
import { randomUUID } from 'crypto';
import {
  assertBancoDeTeste,
  comBancoDeTeste,
  sqlTabelasParaTruncar,
} from '../../src/shared/testing/e2e-database-guard';

let cachedTruncateTableNames: string | null = null;

// Carrega o .env para reaproveitar credenciais/host, mas o banco é sempre
// redirecionado para o de teste logo abaixo — o .env aponta para o de dev, e
// `cleanDatabase` trunca tudo.
config({ path: resolve(__dirname, '../../.env') });

// Definir valores padrão para testes caso não existam
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-key-for-e2e-tests-123456789';
}
process.env.DATABASE_URL = comBancoDeTeste(
  process.env.DATABASE_URL ??
    'postgresql://inexci_user:inexci_pass@localhost:5432/inexci',
);

export async function createTestApp(): Promise<INestApplication> {
  // NODE_ENV=test desabilita rate limiting via CustomThrottlerGuard
  process.env.NODE_ENV = 'test';

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();

  // Configurar pipes globais como na aplicação real
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();
  return app;
}

export async function cleanDatabase(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  // Fail-closed: nunca truncar um banco que não seja o de teste.
  await assertBancoDeTeste({
    query: (sql: string) =>
      dataSource.query(sql) as Promise<{ current_database: string }[]>,
  });

  if (!cachedTruncateTableNames) {
    // Resolve uma vez por processo de teste para evitar custo repetido no beforeEach.
    const tables = await dataSource.query(sqlTabelasParaTruncar());
    cachedTruncateTableNames = tables
      .map((table: { tablename: string }) => `"${table.tablename}"`)
      .join(', ');
  }

  if (cachedTruncateTableNames) {
    await dataSource.query(
      `TRUNCATE TABLE ${cachedTruncateTableNames} RESTART IDENTITY CASCADE`,
    );
  }
}

// Criar dados de seed para testes (procedimentos e dados essenciais)
export async function seedTestData(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);

  // O catálogo agora é por tenant (`procedures.owner_id`).
  // Em cenários sem usuário criado, não há owner para seed.
  const owners = await dataSource.query(`
    SELECT id FROM users ORDER BY created_at ASC LIMIT 1
  `);
  const ownerId = owners[0]?.id as string | undefined;
  if (!ownerId) return;

  const existingProcedures = await dataSource.query(
    `SELECT COUNT(*)::int as count FROM procedures WHERE owner_id = $1`,
    [ownerId],
  );

  if ((existingProcedures[0]?.count ?? 0) === 0) {
    await dataSource.query(
      `
      INSERT INTO procedures (name, owner_id)
      VALUES
        ('Cirurgia de Catarata', $1),
        ('Cirurgia de Hérnia', $1),
        ('Cirurgia de Vesícula', $1)
    `,
      [ownerId],
    );
  }
}

/**
 * Cria um usuário diretamente no banco de dados com role e status específicos
 * Útil para testar rotas que requerem permissões específicas
 */
/**
 * Marca o e-mail de um usuário como verificado — o equivalente a clicar no
 * link enviado por e-mail.
 *
 * `POST /auth/login` passou a recusar quem não confirmou o e-mail
 * (`auth.service.ts`), mas os e2e nasceram antes dessa regra e ainda fazem
 * "registra → loga em seguida". Sem este passo intermediário o login devolve
 * 403 e o teste falha por um motivo que não é o que ele quer verificar.
 */
export async function verifyUserEmail(
  app: INestApplication,
  email: string,
): Promise<void> {
  const dataSource = app.get(DataSource);
  await dataSource.query(
    `UPDATE users SET email_verified = true, email_verified_at = NOW() WHERE email = $1`,
    [email],
  );
}

/**
 * Aceita Política de Privacidade e Termos de Uso — o que o usuário faz no
 * onboarding (`ConsentGate`).
 *
 * O `ConsentsGuard` é global e responde 403 em qualquer rota autenticada
 * enquanto os dois aceites faltarem. `/auth/register` não os grava, então um
 * usuário criado pela API e usado direto num teste esbarra no guard e o teste
 * falha por um motivo que não é o que ele quer verificar.
 */
export async function acceptUserConsents(
  app: INestApplication,
  email: string,
): Promise<void> {
  const dataSource = app.get(DataSource);
  await dataSource.query(
    `UPDATE users
        SET privacy_policy_accepted_at = NOW(),
            terms_of_use_accepted_at = NOW()
      WHERE email = $1`,
    [email],
  );
}

/** Atalho: confirma o e-mail e aceita os consentimentos de uma vez. */
export async function prepararUsuarioParaLogin(
  app: INestApplication,
  email: string,
): Promise<void> {
  await verifyUserEmail(app, email);
  await acceptUserConsents(app, email);
}

export async function createUserWithRole(
  app: INestApplication,
  options: {
    email: string;
    name: string;
    role?: 'admin' | 'collaborator';
    status?: 'pending' | 'active' | 'inactive';
    password?: string;
    account_id?: string; // UUID do admin da conta (para collaborators)
  },
): Promise<{
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  account_id: string;
}> {
  const dataSource = app.get(DataSource);
  const bcrypt = require('bcrypt');

  const hashedPassword = await bcrypt.hash(options.password || 'Test@1234', 10);
  const role = options.role || 'admin';
  const status = options.status || 'active';

  if (role === 'admin' && !options.account_id) {
    // Admin: owner_id = self.id
    const generatedId = randomUUID();
    const result = await dataSource.query(
      `
      INSERT INTO users (
        id,
        name,
        email,
        password,
        role,
        status,
        owner_id,
        admin_id,
        phone,
        email_verified,
        email_verified_at,
        privacy_policy_accepted_at,
        terms_of_use_accepted_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $1, NULL, $7, true, NOW(), NOW(), NOW())
      RETURNING id, email, name, role, status, owner_id as account_id
    `,
      [
        generatedId,
        options.name,
        options.email,
        hashedPassword,
        role,
        status,
        '11999999999',
      ],
    );
    return result[0];
  } else {
    // Collaborator: precisa de owner/admin
    const ownerId = options.account_id;
    if (!ownerId) {
      throw new Error('account_id (owner_id) é obrigatório para collaborator');
    }
    const result = await dataSource.query(
      `
      INSERT INTO users (
        name,
        email,
        password,
        role,
        status,
        owner_id,
        admin_id,
        phone,
        email_verified,
        email_verified_at,
        privacy_policy_accepted_at,
        terms_of_use_accepted_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $6, $7, true, NOW(), NOW(), NOW())
      RETURNING id, email, name, role, status, owner_id as account_id
    `,
      [
        options.name,
        options.email,
        hashedPassword,
        role,
        status,
        ownerId,
        '11999999998',
      ],
    );
    return result[0];
  }
}

// Alias para compatibilidade com código existente
export const createUserWithProfile = createUserWithRole;
export const createUserWithPv = createUserWithRole;

export async function closeTestApp(app: INestApplication): Promise<void> {
  if (app) {
    // Fechar filas Bull antes de fechar o app para evitar
    // unhandled rejections do ioredis durante o teardown
    const queueNames = [
      'mail',
      'pdf-generation',
      'document-extraction',
      'whatsapp-messages',
      'surgery-request-status',
      'surgery-request-update',
      'surgery-request-notification',
    ];
    for (const name of queueNames) {
      try {
        const queue = app.get<Queue>(getQueueToken(name));
        if (queue) {
          await queue.close();
        }
      } catch {
        // Queue pode não existir neste módulo
      }
    }
    try {
      await app.close();
    } catch {
      // Ignorar erros de teardown
    }
  }
}
