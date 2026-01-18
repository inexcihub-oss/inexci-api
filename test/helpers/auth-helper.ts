import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';

export interface RegisterData {
  email: string;
  password: string;
  name: string;
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
  } as RegisterData,
  user: {
    email: 'user@test.com',
    password: 'User@1234',
    name: 'User Test',
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
    .send({ email, password })
    .expect(201);

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

  // Tentar fazer login primeiro
  try {
    const auth = await loginUser(app, user.email, user.password);
    return { token: auth.accessToken, user: auth.user };
  } catch (error) {
    // Se falhar, registrar o usuário
    await registerUser(app, user);
    const auth = await loginUser(app, user.email, user.password);
    return { token: auth.accessToken, user: auth.user };
  }
}

export function getAuthHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Gera um token JWT para um usuário específico (útil para testar rotas com diferentes permissões)
 */
export function generateTestToken(userId: number): string {
  const jwt = require('jsonwebtoken');
  const secret =
    process.env.JWT_SECRET || 'test-jwt-secret-key-for-e2e-tests-123456789';
  return jwt.sign({ userId }, secret, { expiresIn: '1h' });
}
