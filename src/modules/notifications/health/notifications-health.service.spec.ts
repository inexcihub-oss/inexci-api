import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotificationsHealthService } from './notifications-health.service';
import { HealthCheckError } from '@nestjs/terminus';
import * as net from 'net';

describe('NotificationsHealthService', () => {
  let service: NotificationsHealthService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsHealthService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                REDIS_HOST: 'localhost',
                REDIS_PORT: 6379,
                MAIL_HOST: 'smtp.example.com',
                MAIL_PORT: 587,
                TWILIO_ACCOUNT_SID: 'AC_test',
                TWILIO_AUTH_TOKEN: 'token_test',
                TWILIO_WHATSAPP_FROM: 'whatsapp:+14155238886',
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(NotificationsHealthService);
    configService = module.get(ConfigService);
  });

  describe('checkTwilio', () => {
    it('retorna status up quando todas as credenciais estão presentes', async () => {
      const result = await service.checkTwilio();
      expect(result.twilio.status).toBe('up');
    });

    it('lança HealthCheckError quando faltam credenciais', async () => {
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'TWILIO_ACCOUNT_SID') return undefined;
        return 'some-value';
      });

      await expect(service.checkTwilio()).rejects.toThrow(HealthCheckError);
    });
  });

  describe('checkRedis', () => {
    it('lança HealthCheckError quando Redis não está acessível', async () => {
      // Porta improvável para forçar timeout/erro
      jest
        .spyOn(configService, 'get')
        .mockImplementation((key: string, def?: any) => {
          if (key === 'REDIS_HOST') return '127.0.0.1';
          if (key === 'REDIS_PORT') return 59999;
          return def;
        });

      await expect(service.checkRedis()).rejects.toThrow(HealthCheckError);
    });
  });

  describe('checkSmtp', () => {
    it('lança HealthCheckError quando SMTP não está acessível', async () => {
      jest
        .spyOn(configService, 'get')
        .mockImplementation((key: string, def?: any) => {
          if (key === 'MAIL_HOST') return '127.0.0.1';
          if (key === 'MAIL_PORT') return 59998;
          return def;
        });

      await expect(service.checkSmtp()).rejects.toThrow(HealthCheckError);
    });
  });
});
