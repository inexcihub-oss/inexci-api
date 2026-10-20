import { Logger } from '@nestjs/common';
import { auditProntuarioAccess, registerProntuarioAuditSink } from './audit';
import { requestContextStorage } from './request-context';
import { ClinicalAccessAuditService } from './clinical-access-audit.service';

describe('auditProntuarioAccess', () => {
  it('emits a structured prontuario_access event with actor and tenant', () => {
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    auditProntuarioAccess({
      resource: 'surgery_request',
      resourceId: 'sr-1',
      action: 'GET',
      actorUserId: 'user-1',
      tenantId: 'owner-1',
    });

    expect(spy).toHaveBeenCalledWith({
      event: 'prontuario_access',
      resource: 'surgery_request',
      resourceId: 'sr-1',
      action: 'GET',
      actorUserId: 'user-1',
      tenantId: 'owner-1',
    });

    spy.mockRestore();
  });

  it('normalizes missing actor/tenant to null', () => {
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    auditProntuarioAccess({
      resource: 'patient',
      resourceId: 'p-1',
      action: 'read',
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: null, tenantId: null }),
    );

    spy.mockRestore();
  });
});

describe('auditProntuarioAccess — persistência', () => {
  afterEach(() => {
    registerProntuarioAuditSink(null);
    jest.restoreAllMocks();
  });

  it('grava no sink com origem http, ip e requestId quando há request', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const sink = jest.fn().mockResolvedValue(undefined);
    registerProntuarioAuditSink(sink);

    requestContextStorage.run({ requestId: 'req-1', ip: '10.0.0.1' }, () =>
      auditProntuarioAccess({
        resource: 'clinical_record',
        resourceId: 'cr-1',
        action: 'read',
        actorUserId: 'user-1',
        tenantId: 'owner-1',
        patientId: 'pac-1',
      }),
    );
    await Promise.resolve();

    expect(sink).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      ownerId: 'owner-1',
      action: 'read',
      resource: 'clinical_record',
      resourceId: 'cr-1',
      patientId: 'pac-1',
      origin: 'http',
      ip: '10.0.0.1',
      requestId: 'req-1',
    });
  });

  it('respeita a origem explícita (IA) e usa system fora de request', () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const sink = jest.fn().mockResolvedValue(undefined);
    registerProntuarioAuditSink(sink);

    auditProntuarioAccess({
      resource: 'patient',
      action: 'list',
      origin: 'ai',
    });
    auditProntuarioAccess({ resource: 'patient', action: 'read' });

    expect(sink.mock.calls[0][0]).toEqual(
      expect.objectContaining({ origin: 'ai', resourceId: null, ip: null }),
    );
    expect(sink.mock.calls[1][0]).toEqual(
      expect.objectContaining({ origin: 'system' }),
    );
  });

  it('falha ao gravar não propaga e é logada', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    registerProntuarioAuditSink(() => Promise.reject(new Error('db fora')));

    expect(() =>
      auditProntuarioAccess({ resource: 'patient', action: 'read' }),
    ).not.toThrow();
    await new Promise((r) => setImmediate(r));

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db fora'));
  });

  it('sink que lança de forma síncrona também não quebra a request', () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    registerProntuarioAuditSink(() => {
      throw new Error('sync');
    });

    expect(() =>
      auditProntuarioAccess({ resource: 'patient', action: 'read' }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});

describe('ClinicalAccessAuditService', () => {
  afterEach(() => registerProntuarioAuditSink(null));

  it('registra o sink no init e grava pelo repositório', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const repo = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ClinicalAccessAuditService(repo as never);
    service.onModuleInit();

    auditProntuarioAccess({
      resource: 'surgery_request',
      resourceId: 'sr-1',
      action: 'GET',
    });
    await Promise.resolve();

    expect(repo.record).toHaveBeenCalledWith(
      expect.objectContaining({ resource: 'surgery_request', action: 'GET' }),
    );

    service.onModuleDestroy();
    repo.record.mockClear();
    auditProntuarioAccess({ resource: 'patient', action: 'read' });
    expect(repo.record).not.toHaveBeenCalled();
  });
});
