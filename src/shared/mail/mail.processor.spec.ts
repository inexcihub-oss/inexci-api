import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bull';
import * as nodemailer from 'nodemailer';
import { MailProcessor } from './mail.processor';
import { mailConfig } from 'src/config/mail.config';
import { NotificationSendLog } from 'src/database/entities/notification-send-log.entity';
import { getRequestContext } from 'src/shared/logging/request-context';

jest.mock('nodemailer');

describe('MailProcessor', () => {
  let processor: MailProcessor;
  let sendMailMock: jest.Mock;
  let mockSendLogRepository: { create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    sendMailMock = jest.fn().mockResolvedValue(undefined);
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: sendMailMock,
    });

    mockSendLogRepository = {
      create: jest.fn().mockImplementation((data) => ({ ...data })),
      save: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailProcessor,
        {
          provide: mailConfig.KEY,
          useValue: {
            host: 'smtp.test',
            port: 587,
            secure: false,
            auth: { user: 'user', pass: 'pass' },
            from: { name: 'Inexci', address: 'no-reply@inexci.com.br' },
            appUrl: null,
          },
        },
        {
          provide: getRepositoryToken(NotificationSendLog),
          useValue: mockSendLogRepository,
        },
      ],
    }).compile();

    processor = module.get(MailProcessor);
  });

  it('deve estar definido', () => {
    expect(processor).toBeDefined();
  });

  it('propaga userId/tenantId do job para o contexto de log (AsyncLocalStorage)', async () => {
    let capturedUserId: string | null | undefined;
    let capturedTenantId: string | null | undefined;
    sendMailMock.mockImplementation(() => {
      const ctx = getRequestContext();
      capturedUserId = ctx?.userId;
      capturedTenantId = ctx?.tenantId;
      return Promise.resolve(undefined);
    });

    const job = {
      data: {
        html: '<p>oi</p>',
        to: 'destino@example.com',
        subject: 'Assunto',
        userId: 'user-77',
        tenantId: 'tenant-77',
      },
    } as Job<any>;

    await processor.handleSendMail(job);

    expect(capturedUserId).toBe('user-77');
    expect(capturedTenantId).toBe('tenant-77');
    expect(getRequestContext()).toBeUndefined();
  });
});
