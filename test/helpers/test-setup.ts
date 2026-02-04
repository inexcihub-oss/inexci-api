import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { resolve } from 'path';

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
      .map(({ tablename }) => `"${tablename}"`)
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
      INSERT INTO procedure (name, tuss_code, active, created_at, updated_at)
      VALUES 
        ('Cirurgia de Catarata', '31201019', true, NOW(), NOW()),
        ('Cirurgia de Hérnia', '31203019', true, NOW(), NOW()),
        ('Cirurgia de Vesícula', '31303029', true, NOW(), NOW())
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
    role?: 'admin' | 'doctor' | 'collaborator'; // UserRole value
    status?: number; // UserStatus value (1=PENDING, 2=ACTIVE, 3=INACTIVE)
    password?: string;
  },
): Promise<{
  id: number;
  email: string;
  name: string;
  role: string;
  status: number;
}> {
  const dataSource = app.get(DataSource);
  const bcrypt = require('bcrypt');

  const hashedPassword = await bcrypt.hash(options.password || 'Test@1234', 10);

  const result = await dataSource.query(
    `
    INSERT INTO "user" (name, email, password, role, status, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    RETURNING id, email, name, role, status
  `,
    [
      options.name,
      options.email,
      hashedPassword,
      options.role || 'doctor',
      options.status || 2, // ACTIVE by default
    ],
  );

  return result[0];
}

// Alias para compatibilidade com código existente
export const createUserWithProfile = createUserWithRole;
export const createUserWithPv = createUserWithRole;

export async function closeTestApp(app: INestApplication): Promise<void> {
  if (app) {
    await app.close();
  }
}
