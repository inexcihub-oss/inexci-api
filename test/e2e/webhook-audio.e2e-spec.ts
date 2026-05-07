import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { WebhookController } from '../../src/modules/webhook/webhook.controller';
import { WebhookService } from '../../src/modules/webhook/webhook.service';
import { AiOrchestratorService } from '../../src/shared/ai/services/ai-orchestrator.service';

describe('Webhook Áudio (e2e)', () => {
  let app: INestApplication;

  const enqueueInboundMessage = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        WebhookService,
        {
          provide: AiOrchestratorService,
          useValue: { enqueueInboundMessage },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: any) => {
              if (key === 'NODE_ENV') return 'test';
              if (key === 'TWILIO_VALIDATE_SIGNATURE') return 'false';
              return defaultValue;
            },
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deve aceitar payload de áudio e enfileirar com classificação', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/twilio')
      .type('form')
      .send({
        From: 'whatsapp:+5511999990000',
        Body: '',
        MessageSid: 'SM-AUDIO-1',
        NumMedia: '1',
        MediaUrl0: 'https://api.twilio.com/media/1',
        MediaContentType0: 'audio/ogg',
        MediaDuration0: '12',
      })
      .expect(200)
      .expect('<Response></Response>');

    expect(enqueueInboundMessage).toHaveBeenCalledWith({
      from: 'whatsapp:+5511999990000',
      body: '',
      messageSid: 'SM-AUDIO-1',
      mediaUrl: 'https://api.twilio.com/media/1',
      media: [
        {
          url: 'https://api.twilio.com/media/1',
          contentType: 'audio/ogg',
          category: 'audio',
          durationSeconds: 12,
        },
      ],
    });
  });
});
