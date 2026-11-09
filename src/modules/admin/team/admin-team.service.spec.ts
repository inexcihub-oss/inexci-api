import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformAuditAction } from 'src/database/entities/platform-audit-log.entity';
import { PlatformAdminStatus } from 'src/database/entities/platform-admin.entity';
import { hashInviteToken } from '../auth/admin-invite.util';
import { AdminTeamService } from './admin-team.service';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';

function build() {
  const teamRepository = {
    listTeam: jest.fn(),
    revokeKeepingOneActive: jest.fn(),
    resetAccess: jest.fn(),
  };
  const admins = {
    findByEmail: jest.fn().mockResolvedValue(null),
    findName: jest.fn().mockResolvedValue('Ana'),
    createInvited: jest.fn().mockResolvedValue({ id: TARGET }),
  };
  const audit = {
    begin: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    succeed: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
  };
  const refreshStore = {
    revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  };
  const mailService = { send: jest.fn().mockResolvedValue(undefined) };
  const configService = {
    get: jest.fn().mockReturnValue('https://app.inexci.com.br'),
  };
  const service = new AdminTeamService(
    teamRepository as never,
    admins as never,
    audit as never,
    refreshStore as never,
    mailService as never,
    configService as unknown as ConfigService,
  );
  return {
    service,
    teamRepository,
    admins,
    audit,
    refreshStore,
    mailService,
  };
}

function tokenDoLink(link: string): string {
  const fragmento = new URLSearchParams(link.split('#')[1]);
  return fragmento.get('token') ?? '';
}

describe('AdminTeamService.create', () => {
  it('cria o admin pendente em platform_admins e audita com o alvo', async () => {
    const ctx = build();

    const result = await ctx.service.create(
      { name: 'Bia', email: '  Bia@Inexci.com ' },
      ACTOR,
    );

    expect(ctx.admins.findByEmail).toHaveBeenCalledWith('bia@inexci.com');
    const criado = ctx.admins.createInvited.mock.calls[0][0];
    expect(criado).toMatchObject({
      name: 'Bia',
      email: 'bia@inexci.com',
      createdById: ACTOR,
    });
    expect(criado.invite.inviteTokenHash).toHaveLength(64);
    expect(ctx.audit.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        actorAdminId: ACTOR,
        action: PlatformAuditAction.PLATFORM_ADMIN_CREATED,
      }),
    );
    expect(ctx.audit.succeed).toHaveBeenCalledWith(
      'audit-1',
      expect.objectContaining({ targetAdminId: TARGET }),
    );
    expect(result).toEqual({ id: TARGET, auditId: 'audit-1' });
  });

  it('envia o convite com o link do painel e o token que bate com o hash gravado', async () => {
    const ctx = build();

    await ctx.service.create({ name: 'Bia', email: 'bia@inexci.com' }, ACTOR);

    const [template, to, , context] = ctx.mailService.send.mock.calls[0];
    expect(template).toBe('invite-platform-admin');
    expect(to).toBe('bia@inexci.com');
    expect(context.inviterName).toBe('Ana');
    expect(context.setupLink).toContain(
      'https://app.inexci.com.br/admin/primeiro-acesso#email=bia%40inexci.com&token=',
    );
    const { invite } = ctx.admins.createInvited.mock.calls[0][0];
    expect(hashInviteToken(tokenDoLink(context.setupLink as string))).toBe(
      invite.inviteTokenHash,
    );
  });

  it('a criação não falha quando a fila de e-mail falha', async () => {
    const ctx = build();
    ctx.mailService.send.mockRejectedValue(new Error('redis offline'));

    await expect(
      ctx.service.create({ name: 'Bia', email: 'bia@inexci.com' }, ACTOR),
    ).resolves.toEqual(expect.objectContaining({ auditId: 'audit-1' }));
  });

  it('e-mail já cadastrado responde 409 sem criar nem auditar', async () => {
    const ctx = build();
    ctx.admins.findByEmail.mockResolvedValue({ id: 'x' });

    await expect(
      ctx.service.create({ name: 'Bia', email: 'bia@inexci.com' }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.admins.createInvited).not.toHaveBeenCalled();
    expect(ctx.audit.begin).not.toHaveBeenCalled();
  });

  it('corrida no índice de e-mail vira 409 e marca a auditoria como falha', async () => {
    const ctx = build();
    ctx.admins.createInvited.mockRejectedValue({
      code: '23505',
      constraint: 'uq_platform_admins_email_lower',
    });

    await expect(
      ctx.service.create({ name: 'Bia', email: 'bia@inexci.com' }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.audit.fail).toHaveBeenCalledWith('audit-1', expect.any(String));
    expect(ctx.mailService.send).not.toHaveBeenCalled();
  });
});

describe('AdminTeamService.revoke', () => {
  it('revoga, apaga os refresh tokens e audita com o alvo', async () => {
    const ctx = build();
    ctx.teamRepository.revokeKeepingOneActive.mockResolvedValue({
      result: 'revoked',
      before: { status: PlatformAdminStatus.ACTIVE },
    });

    const result = await ctx.service.revoke(
      TARGET,
      { reason: 'Saiu da equipe' },
      ACTOR,
    );

    expect(ctx.refreshStore.revokeAllForUser).toHaveBeenCalledWith(TARGET);
    expect(ctx.audit.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        actorAdminId: ACTOR,
        action: PlatformAuditAction.PLATFORM_ADMIN_REVOKED,
        targetAdminId: TARGET,
        reason: 'Saiu da equipe',
      }),
    );
    expect(ctx.audit.succeed).toHaveBeenCalledWith('audit-1', {
      after: { status: PlatformAdminStatus.INACTIVE },
    });
    expect(result).toEqual({ id: TARGET, auditId: 'audit-1' });
  });

  it('não revoga a si mesmo (409) e nem abre auditoria', async () => {
    const ctx = build();

    await expect(
      ctx.service.revoke(ACTOR, { reason: 'Saiu da equipe' }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.teamRepository.revokeKeepingOneActive).not.toHaveBeenCalled();
    expect(ctx.audit.begin).not.toHaveBeenCalled();
  });

  it('não revoga o último administrador ativo (409)', async () => {
    const ctx = build();
    ctx.teamRepository.revokeKeepingOneActive.mockResolvedValue({
      result: 'last_active_admin',
    });

    await expect(
      ctx.service.revoke(TARGET, { reason: 'Saiu da equipe' }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.refreshStore.revokeAllForUser).not.toHaveBeenCalled();
    expect(ctx.audit.fail).toHaveBeenCalledWith('audit-1', expect.any(String));
  });

  it('quem já está revogado responde 409', async () => {
    const ctx = build();
    ctx.teamRepository.revokeKeepingOneActive.mockResolvedValue({
      result: 'already_inactive',
    });

    await expect(
      ctx.service.revoke(TARGET, { reason: 'Saiu da equipe' }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.audit.fail).toHaveBeenCalled();
  });

  it('alvo inexistente responde 404', async () => {
    const ctx = build();
    ctx.teamRepository.revokeKeepingOneActive.mockResolvedValue({
      result: 'not_found',
    });

    await expect(
      ctx.service.revoke(TARGET, { reason: 'Saiu da equipe' }, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.refreshStore.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('falha no Redis não desfaz a revogação, porque o token_version já subiu', async () => {
    const ctx = build();
    ctx.teamRepository.revokeKeepingOneActive.mockResolvedValue({
      result: 'revoked',
      before: { status: PlatformAdminStatus.ACTIVE },
    });
    ctx.refreshStore.revokeAllForUser.mockRejectedValue(new Error('offline'));

    await expect(
      ctx.service.revoke(TARGET, { reason: 'Saiu da equipe' }, ACTOR),
    ).resolves.toEqual({ id: TARGET, auditId: 'audit-1' });
    expect(ctx.audit.succeed).toHaveBeenCalled();
  });
});

describe('AdminTeamService.resetAccess', () => {
  it('zera o acesso, derruba as sessões, audita e reenvia o convite', async () => {
    const ctx = build();
    ctx.teamRepository.resetAccess.mockResolvedValue({
      result: 'reset',
      before: { status: PlatformAdminStatus.ACTIVE, mfaEnabled: true },
      name: 'Bia',
      email: 'bia@inexci.com',
    });

    const result = await ctx.service.resetAccess(
      TARGET,
      { reason: 'Perdeu o celular' },
      ACTOR,
    );

    const invite = ctx.teamRepository.resetAccess.mock.calls[0][1];
    expect(ctx.teamRepository.resetAccess).toHaveBeenCalledWith(
      TARGET,
      expect.objectContaining({ inviteTokenHash: expect.any(String) }),
    );
    expect(ctx.refreshStore.revokeAllForUser).toHaveBeenCalledWith(TARGET);
    expect(ctx.audit.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        action: PlatformAuditAction.PLATFORM_ADMIN_ACCESS_RESET,
        targetAdminId: TARGET,
        reason: 'Perdeu o celular',
      }),
    );
    expect(ctx.audit.succeed).toHaveBeenCalledWith(
      'audit-1',
      expect.objectContaining({
        after: expect.objectContaining({
          status: PlatformAdminStatus.PENDING,
          previousMfaEnabled: true,
        }),
      }),
    );
    const [, to, , context] = ctx.mailService.send.mock.calls[0];
    expect(to).toBe('bia@inexci.com');
    expect(hashInviteToken(tokenDoLink(context.setupLink as string))).toBe(
      invite.inviteTokenHash,
    );
    expect(result).toEqual({ id: TARGET, auditId: 'audit-1' });
  });

  it('reativa um admin revogado como pendente', async () => {
    const ctx = build();
    ctx.teamRepository.resetAccess.mockResolvedValue({
      result: 'reset',
      before: { status: PlatformAdminStatus.INACTIVE, mfaEnabled: false },
      name: 'Bia',
      email: 'bia@inexci.com',
    });

    await ctx.service.resetAccess(TARGET, { reason: 'Voltou à equipe' }, ACTOR);

    expect(ctx.audit.succeed).toHaveBeenCalledWith(
      'audit-1',
      expect.objectContaining({
        after: expect.objectContaining({
          status: PlatformAdminStatus.PENDING,
          previousStatus: PlatformAdminStatus.INACTIVE,
        }),
      }),
    );
  });

  it('não redefine o próprio acesso (409)', async () => {
    const ctx = build();

    await expect(
      ctx.service.resetAccess(ACTOR, { reason: 'Perdeu o celular' }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.teamRepository.resetAccess).not.toHaveBeenCalled();
    expect(ctx.audit.begin).not.toHaveBeenCalled();
  });

  it('alvo inexistente responde 404 e marca a auditoria como falha', async () => {
    const ctx = build();
    ctx.teamRepository.resetAccess.mockResolvedValue({ result: 'not_found' });

    await expect(
      ctx.service.resetAccess(TARGET, { reason: 'Perdeu o celular' }, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.audit.fail).toHaveBeenCalledWith('audit-1', expect.any(String));
    expect(ctx.mailService.send).not.toHaveBeenCalled();
  });
});

describe('AdminTeamService.list', () => {
  it('mapeia status, MFA, último acesso e quem convidou, sem hasClinic', async () => {
    const ctx = build();
    const created = new Date('2026-10-01T10:00:00Z');
    ctx.teamRepository.listTeam.mockResolvedValue([
      {
        id: TARGET,
        name: 'Bia',
        email: 'bia@inexci.com',
        status: PlatformAdminStatus.PENDING,
        mfaEnabled: false,
        lastSeenAt: null,
        createdAt: created,
        createdById: ACTOR,
        createdByName: 'Ana',
      },
    ]);

    const [row] = await ctx.service.list();

    expect(row).toEqual({
      id: TARGET,
      name: 'Bia',
      email: 'bia@inexci.com',
      active: false,
      status: 'pending',
      mfaEnabled: false,
      lastSeenAt: null,
      createdBy: 'Ana',
      createdById: ACTOR,
      createdAt: created,
    });
  });
});
