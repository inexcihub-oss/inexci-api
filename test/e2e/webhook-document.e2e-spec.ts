import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { WebhookController } from '../../src/modules/webhook/webhook.controller';
import { WebhookService } from '../../src/modules/webhook/webhook.service';
import { AiOrchestratorService } from '../../src/shared/ai/services/ai-orchestrator.service';

/**
 * E2E do Sprint 4 — exercita o webhook Twilio recebendo:
 *  - imagem (image/jpeg) → categoria `image`,
 *  - PDF (application/pdf) → categoria `pdf`,
 *  - mensagem de texto sem mídia (intent reply 1/2/3),
 *
 * e garante que o controller normaliza corretamente o payload antes de
 * delegar ao `AiOrchestratorService.enqueueInboundMessage`. O processamento
 * pesado (download, OCR, classifier, vision fallback) é coberto por specs
 * unitárias dedicadas — aqui validamos apenas o contrato HTTP.
 */
describe('Webhook Documentos (e2e)', () => {
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

  it('classifica imagem como categoria "image" e enfileira', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/twilio')
      .type('form')
      .send({
        From: 'whatsapp:+5511988880001',
        Body: '',
        MessageSid: 'SM-DOC-IMAGE-1',
        NumMedia: '1',
        MediaUrl0: 'https://api.twilio.com/media/img1',
        MediaContentType0: 'image/jpeg',
      })
      .expect(200)
      .expect('<Response></Response>');

    expect(enqueueInboundMessage).toHaveBeenCalledTimes(1);
    expect(enqueueInboundMessage).toHaveBeenCalledWith({
      from: 'whatsapp:+5511988880001',
      body: '',
      messageSid: 'SM-DOC-IMAGE-1',
      mediaUrl: 'https://api.twilio.com/media/img1',
      media: [
        {
          url: 'https://api.twilio.com/media/img1',
          contentType: 'image/jpeg',
          category: 'image',
          durationSeconds: null,
        },
      ],
    });
  });

  it('classifica PDF como categoria "pdf" e enfileira', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/twilio')
      .type('form')
      .send({
        From: 'whatsapp:+5511988880002',
        Body: '',
        MessageSid: 'SM-DOC-PDF-1',
        NumMedia: '1',
        MediaUrl0: 'https://api.twilio.com/media/pdf1',
        MediaContentType0: 'application/pdf',
      })
      .expect(200);

    expect(enqueueInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'whatsapp:+5511988880002',
        media: [
          expect.objectContaining({
            url: 'https://api.twilio.com/media/pdf1',
            contentType: 'application/pdf',
            category: 'pdf',
          }),
        ],
      }),
    );
  });

  it('encaminha intent reply "1" sem mídia preservando o body', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/twilio')
      .type('form')
      .send({
        From: 'whatsapp:+5511988880003',
        Body: '1',
        MessageSid: 'SM-DOC-INTENT-1',
        NumMedia: '0',
      })
      .expect(200);

    expect(enqueueInboundMessage).toHaveBeenCalledWith({
      from: 'whatsapp:+5511988880003',
      body: '1',
      messageSid: 'SM-DOC-INTENT-1',
      mediaUrl: null,
      media: [],
    });
  });

  it('classifica MIME desconhecido (xlsx) como "other" e ainda enfileira', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/twilio')
      .type('form')
      .send({
        From: 'whatsapp:+5511988880004',
        Body: '',
        MessageSid: 'SM-DOC-OTHER-1',
        NumMedia: '1',
        MediaUrl0: 'https://api.twilio.com/media/xls1',
        MediaContentType0:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(200);

    expect(enqueueInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        media: [expect.objectContaining({ category: 'other' })],
      }),
    );
  });

  it('aceita múltiplas mídias e classifica cada uma de forma independente', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/twilio')
      .type('form')
      .send({
        From: 'whatsapp:+5511988880005',
        Body: '',
        MessageSid: 'SM-DOC-MULTI-1',
        NumMedia: '2',
        MediaUrl0: 'https://api.twilio.com/media/img1',
        MediaContentType0: 'image/png',
        MediaUrl1: 'https://api.twilio.com/media/pdf1',
        MediaContentType1: 'application/pdf',
      })
      .expect(200);

    expect(enqueueInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        media: [
          expect.objectContaining({ category: 'image' }),
          expect.objectContaining({ category: 'pdf' }),
        ],
      }),
    );
  });
});
