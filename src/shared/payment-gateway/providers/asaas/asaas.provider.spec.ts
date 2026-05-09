import { ConfigService } from '@nestjs/config';
import { AsaasProvider } from './asaas.provider';
import { PaymentGatewayError } from '../../payment-gateway.interface';

describe('AsaasProvider', () => {
  let provider: AsaasProvider;
  let http: any;
  const mkConfig = (overrides: Record<string, any> = {}) =>
    ({
      get: (key: string, def?: any) => {
        const map: Record<string, any> = {
          ASAAS_WEBHOOK_TOKEN: 'secret-token',
          ...overrides,
        };
        return map[key] ?? def;
      },
    }) as unknown as ConfigService;

  beforeEach(() => {
    http = { request: jest.fn() };
    provider = new AsaasProvider(http, mkConfig());
  });

  describe('createCustomer', () => {
    it('chama POST /customers e normaliza resposta', async () => {
      http.request.mockResolvedValue({
        id: 'cus_1',
        name: 'Maria',
        email: 'maria@x.com',
        cpfCnpj: '12345678901',
        mobilePhone: '11999999999',
      });

      const result = await provider.createCustomer({
        ownerId: 'owner-1',
        name: 'Maria',
        email: 'maria@x.com',
        cpfCnpj: '12345678901',
      });

      expect(http.request).toHaveBeenCalledWith(
        'POST',
        '/customers',
        expect.objectContaining({
          externalReference: 'owner-1',
          cpfCnpj: '12345678901',
        }),
      );
      expect(result).toMatchObject({
        id: 'cus_1',
        name: 'Maria',
        email: 'maria@x.com',
      });
    });
  });

  describe('createSubscription', () => {
    it('converte cents → reais e formata data como YYYY-MM-DD', async () => {
      http.request.mockResolvedValue({
        id: 'sub_1',
        customer: 'cus_1',
        billingType: 'CREDIT_CARD',
        value: 199.0,
        cycle: 'MONTHLY',
        nextDueDate: '2026-02-01',
        status: 'ACTIVE',
      });

      await provider.createSubscription({
        customerId: 'cus_1',
        paymentMethodToken: 'tok',
        amountCents: 19900,
        cycle: 'MONTHLY',
        nextDueDate: new Date(Date.UTC(2026, 1, 1)),
        description: 'Plano',
        externalReference: 'sub-int-1',
      });

      const [method, path, body] = http.request.mock.calls[0];
      expect(method).toBe('POST');
      expect(path).toBe('/subscriptions');
      expect(body.value).toBe(199);
      expect(body.nextDueDate).toBe('2026-02-01');
      expect(body.billingType).toBe('CREDIT_CARD');
      expect(body.creditCardToken).toBe('tok');
      expect(body.externalReference).toBe('sub-int-1');
    });
  });

  describe('verifyWebhook', () => {
    it('aceita quando o header bate com ASAAS_WEBHOOK_TOKEN', () => {
      expect(() =>
        provider.verifyWebhook({
          payload: {},
          headers: { 'asaas-access-token': 'secret-token' },
        }),
      ).not.toThrow();
    });

    it('rejeita quando o header é inválido', () => {
      expect(() =>
        provider.verifyWebhook({
          payload: {},
          headers: { 'asaas-access-token': 'wrong' },
        }),
      ).toThrow(PaymentGatewayError);
    });

    it('rejeita quando o token não está configurado', () => {
      provider = new AsaasProvider(http, mkConfig({ ASAAS_WEBHOOK_TOKEN: '' }));
      expect(() =>
        provider.verifyWebhook({
          payload: {},
          headers: { 'asaas-access-token': 'anything' },
        }),
      ).toThrow(PaymentGatewayError);
    });
  });

  describe('parseWebhookEvent', () => {
    it('mapeia PAYMENT_CONFIRMED para invoice.paid', () => {
      const event = provider.parseWebhookEvent({
        event: 'PAYMENT_CONFIRMED',
        dateCreated: '2026-02-01T10:00:00Z',
        payment: {
          id: 'pay_1',
          customer: 'cus_1',
          subscription: 'sub_1',
          status: 'CONFIRMED',
          billingType: 'CREDIT_CARD',
          value: 199,
          dueDate: '2026-02-01',
        },
      });

      expect(event.type).toBe('invoice.paid');
      expect(event.eventId).toContain('PAYMENT_CONFIRMED');
      expect(event.refs?.invoiceId).toBe('pay_1');
      expect(event.refs?.subscriptionId).toBe('sub_1');
    });

    it('mapeia PAYMENT_OVERDUE para invoice.overdue', () => {
      const event = provider.parseWebhookEvent({
        event: 'PAYMENT_OVERDUE',
        payment: {
          id: 'pay_2',
          customer: 'cus_1',
          subscription: 'sub_1',
          status: 'OVERDUE',
          billingType: 'CREDIT_CARD',
          value: 199,
          dueDate: '2026-02-01',
        },
      });
      expect(event.type).toBe('invoice.overdue');
    });

    it('mapeia SUBSCRIPTION_DELETED para subscription.canceled', () => {
      const event = provider.parseWebhookEvent({
        event: 'SUBSCRIPTION_DELETED',
        subscription: {
          id: 'sub_1',
          customer: 'cus_1',
          billingType: 'CREDIT_CARD',
          value: 199,
          nextDueDate: '2026-02-01',
          cycle: 'MONTHLY',
          status: 'INACTIVE',
        },
      });
      expect(event.type).toBe('subscription.canceled');
      expect(event.refs?.subscriptionId).toBe('sub_1');
    });

    it('eventos desconhecidos viram type=unknown', () => {
      const event = provider.parseWebhookEvent({ foo: 'bar' });
      expect(event.type).toBe('unknown');
    });
  });
});
