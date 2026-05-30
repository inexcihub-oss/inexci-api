import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';
import { getQueueToken } from '@nestjs/bull';
import { Queue } from 'bull';

// Carregar variáveis de ambiente para testes
config({ path: resolve(__dirname, '../../.env') });

// Definir valores padrão para testes caso não existam
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-key-for-e2e-tests-123456789';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    'postgresql://inexci_user:inexci_pass@localhost:5432/inexci';
}

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

  try {
    // Obter todas as tabelas
    const tables = await dataSource.query(`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename != 'migrations'
    `);

    // Desabilitar triggers e fazer TRUNCATE em uma única transação
    await dataSource.query('BEGIN');
    await dataSource.query('SET CONSTRAINTS ALL DEFERRED');

    // Construir e executar TRUNCATE único para todas as tabelas
    const tableNames = tables
      .map((table: { tablename: string }) => `"${table.tablename}"`)
      .join(', ');
    if (tableNames) {
      await dataSource.query(
        `TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`,
      );
    }

    await dataSource.query('COMMIT');
  } catch (error) {
    await dataSource.query('ROLLBACK');
    throw error;
  }
}

// Criar dados de seed para testes (procedimentos e dados essenciais)
export async function seedTestData(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);

  // Criar procedimentos de teste se não existirem
  const existingProcedures = await dataSource.query(`
    SELECT COUNT(*) as count FROM procedure
  `);

  if (parseInt(existingProcedures[0].count) === 0) {
    await dataSource.query(`
      INSERT INTO procedure (name)
      VALUES 
        ('Cirurgia de Catarata'),
        ('Cirurgia de Hérnia'),
        ('Cirurgia de Vesícula')
      ON CONFLICT DO NOTHING
    `);
  }
}

/**
 * Cria um usuário diretamente no banco de dados com role e status específicos
 * Útil para testar rotas que requerem permissões específicas
 */
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
    // Admin: account_id = self.id — precisa gerar UUID antes
    const [{ id: generatedId }] = await dataSource.query(
      `SELECT uuid_generate_v4() AS id`,
    );
    const result = await dataSource.query(
      `
      INSERT INTO "user" (id, name, email, password, role, status, account_id)
      VALUES ($1, $2, $3, $4, $5, $6, $1)
      RETURNING id, email, name, role, status, account_id
    `,
      [generatedId, options.name, options.email, hashedPassword, role, status],
    );
    return result[0];
  } else {
    // Collaborator: precisa de account_id fornecido
    const result = await dataSource.query(
      `
      INSERT INTO "user" (name, email, password, role, status, account_id, admin_id)
      VALUES ($1, $2, $3, $4, $5, $6, $6)
      RETURNING id, email, name, role, status, account_id
    `,
      [
        options.name,
        options.email,
        hashedPassword,
        role,
        status,
        options.account_id,
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
