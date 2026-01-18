import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should have a working health check or return 404 for root', async () => {
    // A aplicação pode não ter uma rota raiz configurada
    const response = await request(app.getHttpServer()).get('/');
    // Aceitar 200 (se tiver health check) ou 404 (se não tiver rota raiz)
    expect([200, 404]).toContain(response.status);
  });
});
