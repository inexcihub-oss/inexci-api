import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from 'src/database/entities/user.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import { JwtStrategy } from 'src/modules/auth/jwt.strategy';
import {
  JWT_DEFAULT_AUDIENCE,
  JWT_DEFAULT_ISSUER,
} from 'src/modules/auth/jwt-payload.interface';
import { AdminTokenService } from './admin-token.service';

const SECRET = 'segredo-de-teste';

type Resultado =
  | { tipo: 'success'; user: unknown }
  | { tipo: 'fail'; info: unknown }
  | { tipo: 'error'; err: unknown };

function autenticar(strategy: JwtStrategy, token: string): Promise<Resultado> {
  return new Promise((resolve) => {
    const alvo = strategy as unknown as {
      success: (user: unknown) => void;
      fail: (info: unknown) => void;
      error: (err: unknown) => void;
      authenticate: (req: unknown, options?: unknown) => void;
    };
    alvo.success = (user) => resolve({ tipo: 'success', user });
    alvo.fail = (info) => resolve({ tipo: 'fail', info });
    alvo.error = (err) => resolve({ tipo: 'error', err });
    alvo.authenticate({ headers: { authorization: `Bearer ${token}` } });
  });
}

describe('isolamento entre o token do painel e o da clínica', () => {
  const configService = {
    get: jest.fn((chave: string, padrao?: string) =>
      chave === 'JWT_SECRET' ? SECRET : padrao,
    ),
  } as unknown as ConfigService;

  const tokens = new AdminTokenService(configService);
  const admin = { id: 'admin-1', tokenVersion: 3 };

  const clinica = new JwtService({
    secret: SECRET,
    signOptions: {
      expiresIn: '15m',
      issuer: JWT_DEFAULT_ISSUER,
      audience: JWT_DEFAULT_AUDIENCE,
    },
  });

  const userRepository = {
    findOneWithProfile: jest.fn().mockResolvedValue({
      id: 'admin-1',
      ownerId: 'admin-1',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      tokenVersion: 3,
      permissions: [],
      doctorProfile: null,
    }),
  };
  const strategy = new JwtStrategy(
    configService,
    userRepository as unknown as UserRepository,
  );

  it('o token do painel usa a audience própria e carrega adminId e tv', () => {
    const payload = new JwtService({ secret: SECRET }).decode<
      Record<string, unknown>
    >(tokens.signAccess(admin));

    expect(payload).toMatchObject({
      adminId: 'admin-1',
      tv: 3,
      iss: JWT_DEFAULT_ISSUER,
      aud: `${JWT_DEFAULT_AUDIENCE}:admin`,
    });
    expect(payload).not.toHaveProperty('userId');
  });

  it('o token do painel é aceito pelo próprio painel', () => {
    expect(tokens.verifyAccess(tokens.signAccess(admin))).toEqual({
      adminId: 'admin-1',
      tv: 3,
    });
  });

  it('a API da clínica recusa o token do painel', async () => {
    const resultado = await autenticar(strategy, tokens.signAccess(admin));

    expect(resultado.tipo).not.toBe('success');
    expect(userRepository.findOneWithProfile).not.toHaveBeenCalled();
  });

  it('a API da clínica recusa os tokens de etapa do painel', async () => {
    for (const purpose of ['mfa', 'mfa_setup'] as const) {
      const resultado = await autenticar(
        strategy,
        tokens.signStep(purpose, admin),
      );
      expect(resultado.tipo).not.toBe('success');
    }
  });

  it('o painel recusa o token da clínica, mesmo com adminId forjado no payload', () => {
    const daClinica = clinica.sign({ userId: 'admin-1', tv: 3 });
    const forjado = clinica.sign({ adminId: 'admin-1', tv: 3 });

    expect(() => tokens.verifyAccess(daClinica)).toThrow(UnauthorizedException);
    expect(() => tokens.verifyAccess(forjado)).toThrow(UnauthorizedException);
  });

  it('o painel recusa o token de MFA da clínica', () => {
    const mfaClinica = clinica.sign(
      { userId: 'admin-1', tv: 3, purpose: 'mfa' },
      { audience: `${JWT_DEFAULT_AUDIENCE}:mfa`, expiresIn: '5m' },
    );

    expect(() => tokens.verifyStep('mfa', mfaClinica)).toThrow(
      UnauthorizedException,
    );
    expect(() => tokens.verifyAccess(mfaClinica)).toThrow(
      UnauthorizedException,
    );
  });

  it('token de etapa não vale como sessão nem como a outra etapa', () => {
    const mfa = tokens.signStep('mfa', admin);
    const setup = tokens.signStep('mfa_setup', admin);

    expect(() => tokens.verifyAccess(mfa)).toThrow(UnauthorizedException);
    expect(() => tokens.verifyAccess(setup)).toThrow(UnauthorizedException);
    expect(() => tokens.verifyStep('mfa', setup)).toThrow(
      UnauthorizedException,
    );
    expect(() => tokens.verifyStep('mfa_setup', mfa)).toThrow(
      UnauthorizedException,
    );
    expect(tokens.verifyStep('mfa', mfa)).toEqual({
      adminId: 'admin-1',
      tv: 3,
    });
  });

  it('sessão do painel não vale como token de etapa', () => {
    expect(() => tokens.verifyStep('mfa', tokens.signAccess(admin))).toThrow(
      UnauthorizedException,
    );
  });

  it('token assinado com outro segredo é recusado', () => {
    const outro = new AdminTokenService({
      get: jest.fn((chave: string, padrao?: string) =>
        chave === 'JWT_SECRET' ? 'outro-segredo' : padrao,
      ),
    } as unknown as ConfigService);

    expect(() => tokens.verifyAccess(outro.signAccess(admin))).toThrow(
      UnauthorizedException,
    );
  });

  it('os tokens de etapa expiram em 5 minutos e a sessão em 15', () => {
    const decoder = new JwtService({ secret: SECRET });
    const etapa = decoder.decode<{ iat: number; exp: number }>(
      tokens.signStep('mfa', admin),
    );
    const sessao = decoder.decode<{ iat: number; exp: number }>(
      tokens.signAccess(admin),
    );

    expect(etapa.exp - etapa.iat).toBe(5 * 60);
    expect(sessao.exp - sessao.iat).toBe(15 * 60);
  });
});
