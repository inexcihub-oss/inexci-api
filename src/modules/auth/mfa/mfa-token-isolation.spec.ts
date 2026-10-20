import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from 'src/database/entities/user.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import { AuthAttemptLimiter } from '../auth-attempt-limiter';
import { JwtStrategy } from '../jwt.strategy';
import {
  JWT_DEFAULT_AUDIENCE,
  JWT_DEFAULT_ISSUER,
} from '../jwt-payload.interface';
import { SessionRevocationService } from '../session-revocation.service';
import { MfaService } from './mfa.service';

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
    alvo.authenticate({
      headers: { authorization: `Bearer ${token}` },
    });
  });
}

describe('Isolamento do token da segunda etapa (MFA)', () => {
  const configService = {
    get: jest.fn((chave: string, padrao?: string) =>
      chave === 'JWT_SECRET' ? SECRET : padrao,
    ),
  } as unknown as ConfigService;

  const jwtService = new JwtService({
    secret: SECRET,
    signOptions: {
      expiresIn: '15m',
      issuer: JWT_DEFAULT_ISSUER,
      audience: JWT_DEFAULT_AUDIENCE,
    },
  });

  const userRepository = {
    findOneWithProfile: jest.fn().mockResolvedValue({
      id: 'user-1',
      ownerId: 'user-1',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      tokenVersion: 0,
      permissions: [],
      doctorProfile: null,
    }),
  };

  const strategy = new JwtStrategy(
    configService,
    userRepository as unknown as UserRepository,
  );
  const mfaService = new MfaService(
    userRepository as unknown as UserRepository,
    jwtService,
    configService,
    {} as AuthAttemptLimiter,
    {} as SessionRevocationService,
  );

  it('access token comum passa pela JwtStrategy (controle)', async () => {
    const token = jwtService.sign({ userId: 'user-1', tv: 0 });
    const resultado = await autenticar(strategy, token);
    expect(resultado.tipo).toBe('success');
  });

  it('token de MFA é recusado pela JwtStrategy por causa do audience', async () => {
    const token = mfaService.createLoginToken({
      id: 'user-1',
      tokenVersion: 0,
    });
    userRepository.findOneWithProfile.mockClear();
    const resultado = await autenticar(strategy, token);
    expect(resultado.tipo).toBe('fail');
    expect(userRepository.findOneWithProfile).not.toHaveBeenCalled();
  });

  it('mesmo com audience igual, payload com propósito é recusado pelo validate', async () => {
    await expect(
      strategy.validate({ userId: 'user-1', tv: 0, purpose: 'mfa' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('access token comum não serve como token da segunda etapa', () => {
    const token = jwtService.sign({ userId: 'user-1', tv: 0 });
    expect(() => mfaService.verifyLoginToken(token)).toThrow(
      UnauthorizedException,
    );
  });

  it('token com audience de MFA mas sem propósito é recusado', () => {
    const token = jwtService.sign(
      { userId: 'user-1', tv: 0 },
      { audience: `${JWT_DEFAULT_AUDIENCE}:mfa` },
    );
    expect(() => mfaService.verifyLoginToken(token)).toThrow(
      UnauthorizedException,
    );
  });
});
