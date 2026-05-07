import { WebhookController } from './webhook.controller';

describe('WebhookController', () => {
  const webhookServiceMock = {
    validateTwilioSignature: jest.fn(),
  };

  const aiOrchestratorMock = {
    enqueueInboundMessage: jest.fn(),
  };

  let controller: WebhookController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new WebhookController(
      webhookServiceMock as any,
      aiOrchestratorMock as any,
    );
  });

  it('deve extrair mídia inbound e enfileirar payload completo', async () => {
    const reqMock = {
      get: (key: string) => {
        if (key === 'host') return 'api.inexci.local';
        if (key === 'x-forwarded-proto') return 'https';
        return undefined;
      },
      originalUrl: '/webhooks/twilio',
      protocol: 'http',
      body: {
        From: 'whatsapp:+5511999990000',
        MessageSid: 'SM-123',
        NumMedia: '2',
        MediaUrl0: 'https://api.twilio.com/media/0',
        MediaContentType0: 'application/pdf',
        MediaUrl1: 'https://api.twilio.com/media/1',
        MediaContentType1: 'image/jpeg',
      },
    };

    const response = await controller.handleTwilioWebhook(
      {
        From: 'whatsapp:+5511999990000',
        Body: 'segue anexo',
        MessageSid: 'SM-123',
        NumMedia: '2',
        MediaUrl0: 'https://api.twilio.com/media/0',
        MediaContentType0: 'application/pdf',
        MediaUrl1: 'https://api.twilio.com/media/1',
        MediaContentType1: 'image/jpeg',
      },
      'signature',
      reqMock as any,
    );

    expect(webhookServiceMock.validateTwilioSignature).toHaveBeenCalled();
    expect(aiOrchestratorMock.enqueueInboundMessage).toHaveBeenCalledWith({
      from: 'whatsapp:+5511999990000',
      body: 'segue anexo',
      messageSid: 'SM-123',
      mediaUrl: 'https://api.twilio.com/media/0',
      media: [
        {
          url: 'https://api.twilio.com/media/0',
          contentType: 'application/pdf',
        },
        {
          url: 'https://api.twilio.com/media/1',
          contentType: 'image/jpeg',
        },
      ],
    });
    expect(response).toBe('<Response></Response>');
  });

  it('deve ignorar webhook sem From/MessageSid', async () => {
    const reqMock = {
      get: () => 'api.inexci.local',
      originalUrl: '/webhooks/twilio',
      protocol: 'https',
      body: {},
    };

    const response = await controller.handleTwilioWebhook(
      {},
      '',
      reqMock as any,
    );

    expect(aiOrchestratorMock.enqueueInboundMessage).not.toHaveBeenCalled();
    expect(response).toBe('<Response></Response>');
  });
});
