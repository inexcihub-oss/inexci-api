import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PlatformAdminStatus } from 'src/database/entities/platform-admin.entity';
import {
  deriveRecoveryPepper,
  hashRecoveryCode,
} from 'src/modules/auth/mfa/mfa-recovery-codes.util';
import { generateTotp, generateTotpSecret } from 'src/shared/crypto/totp.util';
import {
  ADMIN_CONVITE_INVALIDO,
  ADMIN_CREDENCIAIS_INVALIDAS,
  AdminAuthService,
} from './admin-auth.service';
import { hashInviteToken } from './admin-invite.util';
import { AdminTokenService } from './admin-token.service';

const SECRET = 'segredo-de-teste';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue('hash-novo'),
}));

function adminAtivo(extra: Record<string, unknown> = {}) {
  return {
    id: ADMIN_ID,
    name: 'Ana',
    email: 'ana@inexci.com',
    status: PlatformAdminStatus.ACTIVE,
    tokenVersion: 2,
    passwordHash: 'hash',
    mfaEnabledAt: null as Date | null,
    ...extra,
  };
}

function build() {
  const configService = {
    get: jest.fn((chave: string, padrao?: string) =>
      chave === 'JWT_SECRET' ? SECRET : padrao,
    ),
  } as unknown as ConfigService;
  const tokens = new AdminTokenService(configService);
  const admins = {
    findForLogin: jest.fn(),
    findSession: jest.fn(),
    findMfaState: jest.fn(),
    findInvite: jest.fn(),
    acceptInvite: jest.fn().mockResolvedValue(true),
    savePendingMfaSecret: jest.fn().mockResolvedValue(true),
    enableMfa: jest.fn().mockResolvedValue(true),
    consumeMfaStep: jest.fn().mockResolvedValue(true),
    consumeMfaRecoveryCode: jest.fn().mockResolvedValue(true),
    replaceMfaRecoveryCodes: jest.fn().mockResolvedValue(true),
    incrementTokenVersion: jest.fn().mockResolvedValue(undefined),
    touchLastSeen: jest.fn().mockResolvedValue(undefined),
  };
  const refreshStore = {
    issue: jest.fn().mockResolvedValue('refresh-novo'),
    consume: jest.fn(),
    revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  };
  const limiter = {
    isLoginLocked: jest.fn().mockResolvedValue(false),
    registerLoginFailure: jest.fn().mockResolvedValue(undefined),
    clearLoginFailures: jest.fn().mockResolvedValue(undefined),
    isMfaLocked: jest.fn().mockResolvedValue(false),
    registerMfaFailure: jest.fn().mockResolvedValue(false),
    clearMfaFailures: jest.fn().mockResolvedValue(undefined),
    isRecoveryValidationLocked: jest.fn().mockResolvedValue(false),
    registerRecoveryFailure: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AdminAuthService(
    admins as never,
    tokens,
    refreshStore as never,
    limiter as never,
    configService,
  );
  return { service, tokens, admins, refreshStore, limiter };
}

async function erroDe(promessa: Promise<unknown>): Promise<HttpException> {
  return promessa.then(
    () => {
      throw new Error('esperava erro');
    },
    (err: HttpException) => err,
  );
}

describe('AdminAuthService.login', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sem MFA ativo devolve a etapa de cadastro do MFA, nunca uma sessão', async () => {
    const ctx = build();
    ctx.admins.findForLogin.mockResolvedValue(adminAtivo());
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const result = await ctx.service.login('ana@inexci.com', 'Teste123@');

    expect(result.step).toBe('mfa_setup');
    expect(result).not.toHaveProperty('accessToken');
    if (result.step !== 'mfa_setup') throw new Error('etapa errada');
    expect(ctx.tokens.verifyStep('mfa_setup', result.setupToken)).toEqual({
      adminId: ADMIN_ID,
      tv: 2,
    });
    expect(ctx.refreshStore.issue).not.toHaveBeenCalled();
    expect(ctx.limiter.clearLoginFailures).toHaveBeenCalledWith(
      'admin:ana@inexci.com',
    );
  });

  it('com MFA ativo devolve a etapa do código', async () => {
    const ctx = build();
    ctx.admins.findForLogin.mockResolvedValue(
      adminAtivo({ mfaEnabledAt: new Date() }),
    );
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const result = await ctx.service.login('ana@inexci.com', 'Teste123@');

    expect(result.step).toBe('mfa');
    if (result.step !== 'mfa') throw new Error('etapa errada');
    expect(ctx.tokens.verifyStep('mfa', result.mfaToken).adminId).toBe(
      ADMIN_ID,
    );
    expect(ctx.refreshStore.issue).not.toHaveBeenCalled();
  });

  it.each([
    ['senha errada', adminAtivo(), false],
    ['admin inexistente', null, true],
    [
      'admin pendente',
      adminAtivo({ status: PlatformAdminStatus.PENDING }),
      true,
    ],
    [
      'admin inativo',
      adminAtivo({ status: PlatformAdminStatus.INACTIVE }),
      true,
    ],
    ['admin sem senha', adminAtivo({ passwordHash: null }), true],
  ])(
    '%s responde 401 genérico e conta a falha',
    async (_caso, admin, senhaConfere) => {
      const ctx = build();
      ctx.admins.findForLogin.mockResolvedValue(admin);
      (bcrypt.compare as jest.Mock).mockResolvedValue(senhaConfere);

      const erro = await erroDe(ctx.service.login('ana@inexci.com', 'x'));

      expect(erro).toBeInstanceOf(UnauthorizedException);
      expect(erro.getResponse()).toEqual({
        message: ADMIN_CREDENCIAIS_INVALIDAS,
      });
      expect(bcrypt.compare).toHaveBeenCalled();
      expect(ctx.limiter.registerLoginFailure).toHaveBeenCalledWith(
        'admin:ana@inexci.com',
      );
    },
  );

  it('compara o bcrypt mesmo quando o admin não existe', async () => {
    const ctx = build();
    ctx.admins.findForLogin.mockResolvedValue(null);
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await erroDe(ctx.service.login('ninguem@inexci.com', 'Teste123@'));

    expect(bcrypt.compare).toHaveBeenCalledWith('Teste123@', 'hash-novo');
  });

  it('e-mail bloqueado pelo limitador responde 429 antes de olhar a senha', async () => {
    const ctx = build();
    ctx.limiter.isLoginLocked.mockResolvedValue(true);

    const erro = await erroDe(ctx.service.login('ana@inexci.com', 'x'));

    expect(erro.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(ctx.admins.findForLogin).not.toHaveBeenCalled();
  });
});

describe('AdminAuthService MFA', () => {
  beforeEach(() => jest.clearAllMocks());

  it('setup grava o segredo pendente e devolve a URI com o e-mail do admin', async () => {
    const ctx = build();
    ctx.admins.findMfaState.mockResolvedValue(adminAtivo());
    const setupToken = ctx.tokens.signStep('mfa_setup', adminAtivo());

    const result = await ctx.service.setupMfa(setupToken);

    expect(ctx.admins.savePendingMfaSecret).toHaveBeenCalledWith(
      ADMIN_ID,
      result.secret,
    );
    expect(result.otpauthUri).toContain('otpauth://totp/Inexci%20Admin:');
    expect(result.otpauthUri).toContain('ana%40inexci.com');
    expect(result.formattedSecret.replace(/ /g, '')).toBe(result.secret);
  });

  it('setup recusa token de etapa de antes de uma revogação (tv mudou)', async () => {
    const ctx = build();
    ctx.admins.findMfaState.mockResolvedValue(adminAtivo({ tokenVersion: 3 }));
    const setupToken = ctx.tokens.signStep('mfa_setup', adminAtivo());

    await expect(ctx.service.setupMfa(setupToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('setup recusa quem já tem MFA ativo', async () => {
    const ctx = build();
    ctx.admins.findMfaState.mockResolvedValue(
      adminAtivo({ mfaEnabledAt: new Date() }),
    );
    const setupToken = ctx.tokens.signStep('mfa_setup', adminAtivo());

    await expect(ctx.service.setupMfa(setupToken)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('enable confere o código, ativa o MFA e só então abre a sessão', async () => {
    const ctx = build();
    const secret = generateTotpSecret();
    ctx.admins.findMfaState.mockResolvedValue(
      adminAtivo({ mfaPendingSecret: secret }),
    );
    const setupToken = ctx.tokens.signStep('mfa_setup', adminAtivo());

    const result = await ctx.service.enableMfa(
      setupToken,
      generateTotp(secret),
    );

    expect(ctx.admins.enableMfa).toHaveBeenCalledWith(
      ADMIN_ID,
      expect.objectContaining({ secret }),
    );
    expect(result.recoveryCodes).toHaveLength(10);
    expect(result.admin).toEqual({
      id: ADMIN_ID,
      name: 'Ana',
      email: 'ana@inexci.com',
      mfaEnabled: true,
    });
    expect(result.refreshToken).toBe('refresh-novo');
    expect(ctx.tokens.verifyAccess(result.accessToken)).toEqual({
      adminId: ADMIN_ID,
      tv: 2,
    });
    expect(ctx.refreshStore.issue).toHaveBeenCalledWith(ADMIN_ID, 2, undefined);
  });

  it('enable com código errado não abre sessão e conta a falha', async () => {
    const ctx = build();
    ctx.admins.findMfaState.mockResolvedValue(
      adminAtivo({ mfaPendingSecret: generateTotpSecret() }),
    );
    const setupToken = ctx.tokens.signStep('mfa_setup', adminAtivo());

    await expect(
      ctx.service.enableMfa(setupToken, '000000'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.admins.enableMfa).not.toHaveBeenCalled();
    expect(ctx.refreshStore.issue).not.toHaveBeenCalled();
    expect(ctx.limiter.registerMfaFailure).toHaveBeenCalledWith(
      `admin:${ADMIN_ID}`,
    );
  });

  it('login/mfa aceita TOTP com anti-replay', async () => {
    const ctx = build();
    const secret = generateTotpSecret();
    ctx.admins.findMfaState.mockResolvedValue(
      adminAtivo({ mfaEnabledAt: new Date(), mfaSecret: secret }),
    );
    const mfaToken = ctx.tokens.signStep('mfa', adminAtivo());

    const result = await ctx.service.loginWithMfa(
      mfaToken,
      generateTotp(secret),
    );

    expect(ctx.admins.consumeMfaStep).toHaveBeenCalledWith(
      ADMIN_ID,
      expect.any(Number),
    );
    expect(result.admin.mfaEnabled).toBe(true);
    expect(result.accessToken).toBeTruthy();
  });

  it('login/mfa recusa o mesmo passo TOTP reutilizado', async () => {
    const ctx = build();
    const secret = generateTotpSecret();
    ctx.admins.findMfaState.mockResolvedValue(
      adminAtivo({ mfaEnabledAt: new Date(), mfaSecret: secret }),
    );
    ctx.admins.consumeMfaStep.mockResolvedValue(false);
    const mfaToken = ctx.tokens.signStep('mfa', adminAtivo());

    await expect(
      ctx.service.loginWithMfa(mfaToken, generateTotp(secret)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.refreshStore.issue).not.toHaveBeenCalled();
  });

  it('login/mfa aceita código de recuperação e o consome', async () => {
    const ctx = build();
    const codigo = 'ABCDE-FGHJK';
    const hash = hashRecoveryCode(codigo, deriveRecoveryPepper(SECRET));
    ctx.admins.findMfaState.mockResolvedValue(
      adminAtivo({
        mfaEnabledAt: new Date(),
        mfaSecret: generateTotpSecret(),
        mfaRecoveryCodes: [hash],
      }),
    );
    const mfaToken = ctx.tokens.signStep('mfa', adminAtivo());

    await ctx.service.loginWithMfa(mfaToken, codigo);

    expect(ctx.admins.consumeMfaRecoveryCode).toHaveBeenCalledWith(
      ADMIN_ID,
      hash,
    );
  });

  it('login/mfa não aceita token de cadastro do MFA', async () => {
    const ctx = build();
    const setupToken = ctx.tokens.signStep('mfa_setup', adminAtivo());

    await expect(
      ctx.service.loginWithMfa(setupToken, '123456'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.admins.findMfaState).not.toHaveBeenCalled();
  });

  it('login/mfa respeita o bloqueio por tentativas', async () => {
    const ctx = build();
    ctx.admins.findMfaState.mockResolvedValue(
      adminAtivo({ mfaEnabledAt: new Date(), mfaSecret: generateTotpSecret() }),
    );
    ctx.limiter.isMfaLocked.mockResolvedValue(true);
    const mfaToken = ctx.tokens.signStep('mfa', adminAtivo());

    const erro = await erroDe(ctx.service.loginWithMfa(mfaToken, '123456'));

    expect(erro.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('novos códigos de recuperação exigem TOTP válido', async () => {
    const ctx = build();
    const secret = generateTotpSecret();
    ctx.admins.findMfaState.mockResolvedValue(
      adminAtivo({ mfaEnabledAt: new Date(), mfaSecret: secret }),
    );

    const result = await ctx.service.regenerateRecoveryCodes(
      ADMIN_ID,
      generateTotp(secret),
    );

    expect(result.recoveryCodes).toHaveLength(10);
    expect(ctx.admins.replaceMfaRecoveryCodes).toHaveBeenCalledWith(
      ADMIN_ID,
      expect.arrayContaining([expect.stringMatching(/^[0-9a-f]{64}$/)]),
    );
  });
});

describe('AdminAuthService.refresh', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rotaciona na mesma família e devolve sessão nova', async () => {
    const ctx = build();
    ctx.refreshStore.consume.mockResolvedValue({
      status: 'valid',
      userId: ADMIN_ID,
      familyId: 'fam-1',
      tokenVersion: 2,
    });
    ctx.admins.findSession.mockResolvedValue(
      adminAtivo({ mfaEnabledAt: new Date() }),
    );

    const result = await ctx.service.refresh('velho');

    expect(ctx.refreshStore.issue).toHaveBeenCalledWith(ADMIN_ID, 2, 'fam-1');
    expect(result.refreshToken).toBe('refresh-novo');
    expect(result.admin.id).toBe(ADMIN_ID);
  });

  it('reuso derruba todas as sessões (tv++ e refresh apagados)', async () => {
    const ctx = build();
    ctx.refreshStore.consume.mockResolvedValue({
      status: 'reused',
      userId: ADMIN_ID,
      familyId: 'fam-1',
      tokenVersion: 2,
    });

    await expect(ctx.service.refresh('velho')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(ctx.admins.incrementTokenVersion).toHaveBeenCalledWith(ADMIN_ID);
    expect(ctx.refreshStore.revokeAllForUser).toHaveBeenCalledWith(ADMIN_ID);
    expect(ctx.refreshStore.issue).not.toHaveBeenCalled();
  });

  it('janela de graça esgotada responde 409', async () => {
    const ctx = build();
    ctx.refreshStore.consume.mockResolvedValue({
      status: 'grace_exhausted',
      userId: ADMIN_ID,
      familyId: 'fam-1',
      tokenVersion: 2,
    });

    await expect(ctx.service.refresh('velho')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('token desconhecido responde 400', async () => {
    const ctx = build();
    ctx.refreshStore.consume.mockResolvedValue({ status: 'not_found' });

    await expect(ctx.service.refresh('x')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('admin revogado perde o refresh', async () => {
    const ctx = build();
    ctx.refreshStore.consume.mockResolvedValue({
      status: 'valid',
      userId: ADMIN_ID,
      familyId: 'fam-1',
      tokenVersion: 2,
    });
    ctx.admins.findSession.mockResolvedValue(
      adminAtivo({
        status: PlatformAdminStatus.INACTIVE,
        mfaEnabledAt: new Date(),
      }),
    );

    await expect(ctx.service.refresh('velho')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(ctx.refreshStore.revokeAllForUser).toHaveBeenCalledWith(ADMIN_ID);
  });

  it('refresh emitido antes do token_version atual é recusado', async () => {
    const ctx = build();
    ctx.refreshStore.consume.mockResolvedValue({
      status: 'valid',
      userId: ADMIN_ID,
      familyId: 'fam-1',
      tokenVersion: 1,
    });
    ctx.admins.findSession.mockResolvedValue(
      adminAtivo({ mfaEnabledAt: new Date() }),
    );

    await expect(ctx.service.refresh('velho')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(ctx.refreshStore.issue).not.toHaveBeenCalled();
  });
});

describe('AdminAuthService.logout', () => {
  beforeEach(() => jest.clearAllMocks());

  it('apaga os refresh tokens do dono do cookie e do bearer', async () => {
    const ctx = build();
    ctx.refreshStore.consume.mockResolvedValue({
      status: 'valid',
      userId: ADMIN_ID,
      familyId: 'f',
      tokenVersion: 2,
    });

    await ctx.service.logout({
      accessToken: ctx.tokens.signAccess(adminAtivo()),
      refreshToken: 'cookie',
    });

    expect(ctx.refreshStore.revokeAllForUser).toHaveBeenCalledTimes(1);
    expect(ctx.refreshStore.revokeAllForUser).toHaveBeenCalledWith(ADMIN_ID);
  });

  it('sem credenciais válidas não faz nada e não falha', async () => {
    const ctx = build();
    ctx.refreshStore.consume.mockResolvedValue({ status: 'not_found' });

    await expect(
      ctx.service.logout({ accessToken: 'lixo', refreshToken: 'x' }),
    ).resolves.toBeUndefined();
    expect(ctx.refreshStore.revokeAllForUser).not.toHaveBeenCalled();
  });
});

describe('AdminAuthService.acceptInvite', () => {
  beforeEach(() => jest.clearAllMocks());

  const conviteValido = (extra: Record<string, unknown> = {}) => ({
    id: ADMIN_ID,
    status: PlatformAdminStatus.PENDING,
    inviteTokenHash: hashInviteToken('token-certo'),
    inviteExpiresAt: new Date(Date.now() + 60_000),
    ...extra,
  });

  it('com token certo grava a senha forte por hash e ativa o admin', async () => {
    const ctx = build();
    ctx.admins.findInvite.mockResolvedValue(conviteValido());

    await ctx.service.acceptInvite(
      'ana@inexci.com',
      'token-certo',
      'Teste123@',
    );

    expect(bcrypt.hash).toHaveBeenCalledWith('Teste123@', 12);
    expect(ctx.admins.acceptInvite).toHaveBeenCalledWith(
      ADMIN_ID,
      hashInviteToken('token-certo'),
      'hash-novo',
    );
  });

  it.each([
    ['token errado', conviteValido(), 'token-errado'],
    [
      'convite expirado',
      conviteValido({ inviteExpiresAt: new Date(Date.now() - 1000) }),
      'token-certo',
    ],
    [
      'admin já ativo',
      conviteValido({ status: PlatformAdminStatus.ACTIVE }),
      'token-certo',
    ],
    [
      'convite já usado',
      conviteValido({ inviteTokenHash: null }),
      'token-certo',
    ],
    ['e-mail sem convite', null, 'token-certo'],
  ])('%s responde 400 e conta a falha', async (_caso, convite, token) => {
    const ctx = build();
    ctx.admins.findInvite.mockResolvedValue(convite);

    const erro = await erroDe(
      ctx.service.acceptInvite('ana@inexci.com', token, 'Teste123@'),
    );

    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.message).toBe(ADMIN_CONVITE_INVALIDO);
    expect(ctx.admins.acceptInvite).not.toHaveBeenCalled();
    expect(ctx.limiter.registerRecoveryFailure).toHaveBeenCalledWith(
      'admin:invite:ana@inexci.com',
    );
  });

  it('corrida no uso único: segundo aceite não grava nada', async () => {
    const ctx = build();
    ctx.admins.findInvite.mockResolvedValue(conviteValido());
    ctx.admins.acceptInvite.mockResolvedValue(false);

    await expect(
      ctx.service.acceptInvite('ana@inexci.com', 'token-certo', 'Teste123@'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
