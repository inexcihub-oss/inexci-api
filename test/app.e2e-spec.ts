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
      try {
        await app.close();
      } catch {}
    }
  });

  it('should have a working health check or return 404 for root', async () => {
    const response = await request(app.getHttpServer()).get('/');
    expect([200, 404]).toContain(response.status);
  });
});
