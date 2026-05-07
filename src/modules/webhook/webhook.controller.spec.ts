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
          category: 'other',
          durationSeconds: null,
        },
        {
          url: 'https://api.twilio.com/media/1',
          contentType: 'image/jpeg',
          category: 'other',
          durationSeconds: null,
        },
      ],
    });
    expect(response).toBe('<Response></Response>');
  });

  it('deve classificar mídia de áudio', async () => {
    const reqMock = {
      get: () => 'api.inexci.local',
      originalUrl: '/webhooks/twilio',
      protocol: 'https',
      body: {
        From: 'whatsapp:+5511999990000',
        MessageSid: 'SM-456',
        NumMedia: '1',
        MediaUrl0: 'https://api.twilio.com/media/audio-0',
        MediaContentType0: 'audio/ogg',
        MediaDuration0: '21',
      },
    };

    await controller.handleTwilioWebhook(
      {
        From: 'whatsapp:+5511999990000',
        Body: '',
        MessageSid: 'SM-456',
        NumMedia: '1',
        MediaUrl0: 'https://api.twilio.com/media/audio-0',
        MediaContentType0: 'audio/ogg',
        MediaDuration0: '21',
      },
      'signature',
      reqMock as any,
    );

    expect(aiOrchestratorMock.enqueueInboundMessage).toHaveBeenCalledWith({
      from: 'whatsapp:+5511999990000',
      body: '',
      messageSid: 'SM-456',
      mediaUrl: 'https://api.twilio.com/media/audio-0',
      media: [
        {
          url: 'https://api.twilio.com/media/audio-0',
          contentType: 'audio/ogg',
          category: 'audio',
          durationSeconds: 21,
        },
      ],
    });
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

  it('deve mapear ButtonPayload de confirmação para "sim"', async () => {
    const reqMock = {
      get: () => 'api.inexci.local',
      originalUrl: '/webhooks/twilio',
      protocol: 'https',
      body: {
        From: 'whatsapp:+5511999990000',
        MessageSid: 'SM-789',
        Body: '',
        ButtonText: 'Confirmar',
        ButtonPayload: 'AI_CONFIRM_YES',
      },
    };

    await controller.handleTwilioWebhook(
      {
        From: 'whatsapp:+5511999990000',
        Body: '',
        MessageSid: 'SM-789',
        ButtonText: 'Confirmar',
        ButtonPayload: 'AI_CONFIRM_YES',
      },
      'signature',
      reqMock as any,
    );

    expect(aiOrchestratorMock.enqueueInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'whatsapp:+5511999990000',
        body: 'sim',
        messageSid: 'SM-789',
      }),
    );
  });
});
