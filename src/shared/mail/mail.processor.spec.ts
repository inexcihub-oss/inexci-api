import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bull';
import * as nodemailer from 'nodemailer';
import { MailProcessor } from './mail.processor';
import { mailConfig } from 'src/config/mail.config';
import {
  NotificationSendLog,
  NotificationSendStatus,
} from 'src/database/entities/notification-send-log.entity';
import { getRequestContext } from 'src/shared/logging/request-context';
import { AccountStatusService } from 'src/shared/account-status/account-status.service';
import { CONTA_DESATIVADA_MENSAGEM } from 'src/modules/auth/account-deactivation';

jest.mock('nodemailer');

describe('MailProcessor', () => {
  let processor: MailProcessor;
  let sendMailMock: jest.Mock;
  let mockSendLogRepository: { create: jest.Mock; save: jest.Mock };
  let accountStatus: { isDeactivated: jest.Mock };

  beforeEach(async () => {
    sendMailMock = jest.fn().mockResolvedValue(undefined);
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: sendMailMock,
    });

    mockSendLogRepository = {
      create: jest.fn().mockImplementation((data) => ({ ...data })),
      save: jest.fn().mockResolvedValue(undefined),
    };
    accountStatus = { isDeactivated: jest.fn().mockResolvedValue(false) };

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
        { provide: AccountStatusService, useValue: accountStatus },
      ],
    }).compile();

    processor = module.get(MailProcessor);
  });

  it('deve estar definido', () => {
    expect(processor).toBeDefined();
  });

  it('não envia e-mail de conta desativada e registra o motivo no log de envio', async () => {
    accountStatus.isDeactivated.mockResolvedValue(true);
    const job = {
      id: '5',
      attemptsMade: 0,
      data: {
        html: '<p>lembrete</p>',
        to: 'paciente@example.com',
        subject: 'Lembrete',
        tenantId: 'owner-1',
      },
    } as Job<any>;

    await processor.handleSendMail(job);

    expect(accountStatus.isDeactivated).toHaveBeenCalledWith('owner-1');
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(mockSendLogRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: NotificationSendStatus.FAILED,
        errorMessage: CONTA_DESATIVADA_MENSAGEM,
        ownerId: 'owner-1',
      }),
    );
  });

  it('envia normalmente quando o job não é de nenhuma conta', async () => {
    const job = {
      id: '6',
      attemptsMade: 0,
      data: { html: '<p>convite</p>', to: 'a@example.com', subject: 'Convite' },
    } as Job<any>;

    await processor.handleSendMail(job);

    expect(accountStatus.isDeactivated).toHaveBeenCalledWith(undefined);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
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
    expect(mockSendLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'tenant-77', userId: 'user-77' }),
    );
  });

  it('grava a conta nula quando o job não tem tenant', async () => {
    sendMailMock.mockResolvedValue(undefined);
    await processor.handleSendMail({
      data: { html: '<p>oi</p>', to: 'a@b.com', subject: 'S' },
    } as Job<any>);
    expect(mockSendLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: null, userId: null }),
    );
  });
});
