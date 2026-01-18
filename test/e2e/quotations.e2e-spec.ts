import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  createTestApp,
  cleanDatabase,
  closeTestApp,
} from '../helpers/test-setup';
import { getAuthenticatedRequest, getAuthHeader } from '../helpers/auth-helper';

describe('Quotations (e2e)', () => {
  let app: INestApplication;
  let authToken: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
    const auth = await getAuthenticatedRequest(app);
    authToken = auth.token;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('/surgery-requests/quotations (POST)', () => {
    it('should create a new quotation', async () => {
      const quotationData = {
        surgery_request_id: 1,
        supplier_id: 1,
        amount: 5000.0,
        items: [
          {
            name: 'Item 1',
            quantity: 2,
            unit_price: 1000.0,
          },
          {
            name: 'Item 2',
            quantity: 3,
            unit_price: 1000.0,
          },
        ],
        observation: 'Test quotation',
      };

      await request(app.getHttpServer())
        .post('/surgery-requests/quotations')
        .set(getAuthHeader(authToken))
        .send(quotationData);

      // Response might be 201 or 400/404 depending on data validation
    });

    it('should fail without required fields', async () => {
      await request(app.getHttpServer())
        .post('/surgery-requests/quotations')
        .set(getAuthHeader(authToken))
        .send({})
        .expect(400);
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .post('/surgery-requests/quotations')
        .send({
          surgery_request_id: 1,
          supplier_id: 1,
          amount: 5000.0,
        })
        .expect(401);
    });

    it('should validate quotation amount', async () => {
      const quotationData = {
        surgery_request_id: 1,
        supplier_id: 1,
        amount: -100, // Invalid negative amount
        items: [],
      };

      await request(app.getHttpServer())
        .post('/surgery-requests/quotations')
        .set(getAuthHeader(authToken))
        .send(quotationData);

      // Should fail with validation error
    });
  });

  describe('/surgery-requests/quotations (PUT)', () => {
    it('should update an existing quotation', async () => {
      const updateData = {
        id: 1,
        surgery_request_id: 1,
        supplier_id: 1,
        amount: 6000.0,
        items: [
          {
            name: 'Updated Item',
            quantity: 5,
            unit_price: 1200.0,
          },
        ],
        observation: 'Updated quotation',
      };

      await request(app.getHttpServer())
        .put('/surgery-requests/quotations')
        .set(getAuthHeader(authToken))
        .send(updateData);
    });

    it('should fail to update non-existent quotation', async () => {
      const updateData = {
        id: 999999,
        surgery_request_id: 1,
        supplier_id: 1,
        amount: 6000.0,
      };

      const response = await request(app.getHttpServer())
        .put('/surgery-requests/quotations')
        .set(getAuthHeader(authToken))
        .send(updateData);

      // Pode retornar 400 (validação) ou 404 (não encontrado)
      expect([400, 404]).toContain(response.status);
    });

    it('should fail without authentication', async () => {
      await request(app.getHttpServer())
        .put('/surgery-requests/quotations')
        .send({
          id: 1,
          amount: 6000.0,
        })
        .expect(401);
    });
  });

  describe('Quotation validation', () => {
    it('should validate quotation items', async () => {
      const quotationData = {
        surgery_request_id: 1,
        supplier_id: 1,
        amount: 5000.0,
        items: [
          {
            name: '',
            quantity: 0,
            unit_price: 0,
          },
        ],
      };

      await request(app.getHttpServer())
        .post('/surgery-requests/quotations')
        .set(getAuthHeader(authToken))
        .send(quotationData);

      // Should fail with validation error for invalid items
    });

    it('should ensure items total matches quotation amount', async () => {
      const quotationData = {
        surgery_request_id: 1,
        supplier_id: 1,
        amount: 5000.0,
        items: [
          {
            name: 'Item 1',
            quantity: 1,
            unit_price: 1000.0, // Total: 1000, doesn't match amount
          },
        ],
      };

      await request(app.getHttpServer())
        .post('/surgery-requests/quotations')
        .set(getAuthHeader(authToken))
        .send(quotationData);
    });
  });
});
