import { PlatformAuditAction } from 'src/database/entities/platform-audit-log.entity';
import { createHash } from 'node:crypto';
import {
  AdminClinicalAccessService,
  patientRefOf,
} from './admin-clinical-access.service';

const now = new Date('2026-10-28T15:00:00Z');

function build() {
  const volume = {
    totals: jest.fn().mockResolvedValue({ total: 12, users: 2 }),
    byAction: jest.fn().mockResolvedValue([
      {
        resource: 'clinical_record',
        action: 'read',
        origin: 'http',
        total: 9,
      },
    ]),
    byUser: jest.fn().mockResolvedValue([
      {
        userId: 'u1',
        userName: 'Ana',
        resource: 'patient',
        action: 'read',
        total: 4,
        lastAccessAt: now,
        patientId: 'nao-deveria-sair',
      },
    ]),
    daily: jest.fn().mockResolvedValue([{ day: '2026-10-27', total: 12 }]),
    byPatient: jest.fn().mockResolvedValue([
      {
        patientRef: 'a1b2c3d4e5',
        total: 7,
        users: 2,
        lastAccessAt: now,
        patientId: 'nao-deveria-sair',
      },
    ]),
    patientEvents: jest.fn().mockResolvedValue([
      {
        userId: 'u1',
        userName: 'Ana',
        resource: 'clinical_record',
        action: 'read',
        origin: 'http',
        createdAt: now,
        patientId: 'nao-deveria-sair',
      },
    ]),
  };
  const audit = {
    begin: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    succeed: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AdminClinicalAccessService(
    volume as never,
    audit as never,
  );
  return { service, volume, audit };
}

describe('AdminClinicalAccessService', () => {
  it('forAccount devolve só volume, no período pedido', async () => {
    const { service, volume } = build();
    const result = await service.forAccount('o1', 7, now);
    expect(volume.totals).toHaveBeenCalledWith({
      ownerId: 'o1',
      from: new Date('2026-10-21T15:00:00Z'),
      to: now,
    });
    expect(result.totals).toEqual({ total: 12, users: 2 });
    expect(JSON.stringify(result)).not.toContain('nao-deveria-sair');
    expect(Object.keys(result.byUser[0]).sort()).toEqual([
      'action',
      'lastAccessAt',
      'resource',
      'total',
      'userId',
      'userName',
    ]);
  });

  it('export audita com motivo antes de ler e devolve só o volume por usuário', async () => {
    const { service, audit, volume } = build();
    const result = await service.export(
      'o1',
      { reason: 'Pedido da clínica', days: 30 },
      'admin-1',
      now,
    );
    expect(audit.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        actorAdminId: 'admin-1',
        action: PlatformAuditAction.CLINICAL_ACCESS_EXPORTED,
        targetOwnerId: 'o1',
        reason: 'Pedido da clínica',
        before: expect.objectContaining({ days: 30 }),
      }),
    );
    expect(audit.begin.mock.invocationCallOrder[0]).toBeLessThan(
      volume.byUser.mock.invocationCallOrder[0],
    );
    expect(audit.succeed).toHaveBeenCalledWith('audit-1', {
      after: { rows: 1 },
    });
    expect(result.auditLogId).toBe('audit-1');
    expect(JSON.stringify(result.items)).not.toContain('nao-deveria-sair');
  });

  it('falha na leitura marca a auditoria como falha e propaga', async () => {
    const { service, audit, volume } = build();
    volume.byUser.mockRejectedValue(new Error('db fora'));
    await expect(
      service.export('o1', { reason: 'Pedido da clínica' }, 'admin-1', now),
    ).rejects.toThrow('db fora');
    expect(audit.fail).toHaveBeenCalledWith('audit-1', 'db fora');
    expect(audit.succeed).not.toHaveBeenCalled();
  });

  it('forAccount traz os pacientes mais acessados só pelo código anônimo', async () => {
    const { service, volume } = build();
    const result = await service.forAccount('o1', 30, now);
    expect(volume.byPatient).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'o1' }),
      50,
    );
    expect(result.byPatient).toEqual([
      { patientRef: 'a1b2c3d4e5', total: 7, users: 2, lastAccessAt: now },
    ]);
  });

  it('patientRefOf aceita o código do painel ou o id completo', () => {
    const id = '3F2504E0-4F89-11D3-9A0C-0305E82C3301';
    expect(patientRefOf(id)).toBe(
      createHash('md5').update(id.toLowerCase()).digest('hex').slice(0, 10),
    );
    expect(patientRefOf('A1B2C3D4E5')).toBe('a1b2c3d4e5');
  });

  it('forPatient audita com motivo e só o código antes de ler e não devolve o id', async () => {
    const { service, audit, volume } = build();
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    const ref = patientRefOf(id);
    const result = await service.forPatient(
      'o1',
      { reason: 'Clínica pediu quem abriu', patient: id, days: 90 },
      'admin-1',
      now,
    );
    expect(audit.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        actorAdminId: 'admin-1',
        action: PlatformAuditAction.CLINICAL_ACCESS_PATIENT_VIEWED,
        targetOwnerId: 'o1',
        reason: 'Clínica pediu quem abriu',
        before: expect.objectContaining({ patientRef: ref, days: 90 }),
      }),
    );
    expect(JSON.stringify(audit.begin.mock.calls[0])).not.toContain(id);
    expect(audit.begin.mock.invocationCallOrder[0]).toBeLessThan(
      volume.patientEvents.mock.invocationCallOrder[0],
    );
    expect(volume.patientEvents).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'o1' }),
      ref,
      200,
    );
    expect(audit.succeed).toHaveBeenCalledWith('audit-1', {
      after: { rows: 1 },
    });
    expect(result.patientRef).toBe(ref);
    expect(JSON.stringify(result)).not.toContain('nao-deveria-sair');
    expect(JSON.stringify(result)).not.toContain(id);
  });

  it('forPatient com falha na leitura marca a auditoria como falha', async () => {
    const { service, audit, volume } = build();
    volume.patientEvents.mockRejectedValue(new Error('db fora'));
    await expect(
      service.forPatient(
        'o1',
        { reason: 'Pedido da clínica', patient: 'a1b2c3d4e5' },
        'admin-1',
        now,
      ),
    ).rejects.toThrow('db fora');
    expect(audit.fail).toHaveBeenCalledWith('audit-1', 'db fora');
  });
});
