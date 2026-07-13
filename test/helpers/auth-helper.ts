import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createUserWithRole } from './test-setup';
import {
  JWT_DEFAULT_AUDIENCE,
  JWT_DEFAULT_ISSUER,
} from 'src/modules/auth/jwt-payload.interface';

export interface RegisterData {
  email: string;
  password: string;
  name: string;
  phone?: string;
  isDoctor?: boolean;
  crm?: string;
  crmState?: string;
  specialty?: string;
}

export interface AuthTokens {
  accessToken: string;
  user?: any;
}

export const testUsers = {
  admin: {
    email: 'admin@test.com',
    password: 'Admin@1234',
    name: 'Admin Test',
    phone: '11988887777',
    isDoctor: true,
    crm: '999999',
    crmState: 'SP',
    specialty: 'Cirurgia Geral',
  } as RegisterData,
  user: {
    email: 'user@test.com',
    password: 'User@1234',
    name: 'User Test',
    phone: '11988887766',
  } as RegisterData,
};

export async function registerUser(
  app: INestApplication,
  userData: RegisterData,
): Promise<any> {
  const response = await request(app.getHttpServer())
    .post('/auth/register')
    .send({
      name: userData.name,
      email: userData.email,
      password: userData.password,
      phone: userData.phone ?? '11988887777',
    })
    .expect(201);

  return response.body;
}

export async function loginUser(
  app: INestApplication,
  email: string,
  password: string,
): Promise<AuthTokens> {
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password });

  if (![200, 201].includes(response.status)) {
    throw new Error(`Falha no login (${response.status})`);
  }

  return {
    accessToken: response.body.access_token,
    user: response.body.user,
  };
}

export async function getAuthenticatedRequest(
  app: INestApplication,
  userData?: RegisterData,
): Promise<{ token: string; user: any }> {
  const user = userData || testUsers.admin;
  const dataSource = app.get(DataSource);

  const existing = await dataSource.query(
    `
    SELECT id, email, name, role, owner_id
    FROM users
    WHERE email = $1
    LIMIT 1
  `,
    [user.email],
  );

  const dbUser =
    existing[0] ??
    (await createUserWithRole(app, {
      name: user.name,
      email: user.email,
      password: user.password,
      role: 'admin',
      status: 'active',
    }));

  const token = generateTestToken(dbUser.id);

  return {
    token,
    user: {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role,
      ownerId: dbUser.owner_id ?? dbUser.account_id ?? dbUser.id,
    },
  };
}

export function getAuthHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Gera um token JWT para um usuário específico (útil para testar rotas com diferentes permissões)
 */
export function generateTestToken(userId: string | number): string {
  const jwt = require('jsonwebtoken');
  const secret =
    process.env.JWT_SECRET || 'test-jwt-secret-key-for-e2e-tests-123456789';
  return jwt.sign({ userId }, secret, {
    expiresIn: '1h',
    issuer: process.env.JWT_ISSUER || JWT_DEFAULT_ISSUER,
    audience: process.env.JWT_AUDIENCE || JWT_DEFAULT_AUDIENCE,
  });
}
