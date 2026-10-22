import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from 'src/database/entities/user.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import { generateTotp, totpStepAt } from 'src/shared/crypto/totp.util';
import { AuthAttemptLimiter } from '../auth-attempt-limiter';
import { SessionRevocationService } from '../session-revocation.service';
import {
  JWT_DEFAULT_AUDIENCE,
  JWT_DEFAULT_ISSUER,
} from '../jwt-payload.interface';
import { MFA_BLOQUEADO, MFA_CODIGO_INVALIDO, MfaService } from './mfa.service';
import {
  deriveRecoveryPepper,
  hashRecoveryCode,
} from './mfa-recovery-codes.util';

jest.mock('bcryptjs', () => ({ compare: jest.fn() }));
import * as bcryptjs from 'bcryptjs';

const SECRET = 'jwt-secret-de-teste';

type Estado = Pick<
  User,
  | 'id'
  | 'email'
  | 'tokenVersion'
  | 'mfaSecret'
  | 'mfaPendingSecret'
  | 'mfaEnabledAt'
  | 'mfaRecoveryCodes'
  | 'mfaLastUsedStep'
>;

function criarRepositorio(estado: Estado) {
  return {
    findMfaState: jest.fn(async () => ({ ...estado }) as User),
    isMfaEnabled: jest.fn(async () => !!estado.mfaEnabledAt),
    findOne: jest.fn(async () => ({ id: estado.id, password: 'hash' })),
    savePendingMfaSecret: jest.fn(async (_id: string, secret: string) => {
      estado.mfaPendingSecret = secret;
    }),
    enableMfa: jest.fn(
      async (
        _id: string,
        data: {
          secret: string;
          recoveryCodeHashes: string[];
          usedStep: number;
        },
      ) => {
        if (estado.mfaEnabledAt) return false;
        estado.mfaSecret = data.secret;
        estado.mfaPendingSecret = null;
        estado.mfaEnabledAt = new Date();
        estado.mfaRecoveryCodes = data.recoveryCodeHashes;
        estado.mfaLastUsedStep = data.usedStep;
        return true;
      },
    ),
    consumeMfaStep: jest.fn(async (_id: string, step: number) => {
      if (!estado.mfaEnabledAt) return false;
      if (estado.mfaLastUsedStep !== null && estado.mfaLastUsedStep >= step) {
        return false;
      }
      estado.mfaLastUsedStep = step;
      return true;
    }),
    consumeMfaRecoveryCode: jest.fn(async (_id: string, hash: string) => {
      const codigos = estado.mfaRecoveryCodes ?? [];
      if (!codigos.includes(hash)) return false;
      estado.mfaRecoveryCodes = codigos.filter((c) => c !== hash);
      return true;
    }),
    replaceMfaRecoveryCodes: jest.fn(async (_id: string, hashes: string[]) => {
      if (!estado.mfaEnabledAt) return false;
      estado.mfaRecoveryCodes = hashes;
      return true;
    }),
    disableMfa: jest.fn(async () => {
      estado.mfaSecret = null;
      estado.mfaPendingSecret = null;
      estado.mfaEnabledAt = null;
      estado.mfaRecoveryCodes = null;
      estado.mfaLastUsedStep = null;
    }),
  };
}

function criarLimiter() {
  let falhas = 0;
  let bloqueado = false;
  return {
    isMfaLocked: jest.fn(async () => bloqueado),
    registerMfaFailure: jest.fn(async () => {
      falhas += 1;
      if (falhas >= 5) {
        bloqueado = true;
        falhas = 0;
        return true;
      }
      return false;
    }),
    clearMfaFailures: jest.fn(async () => {
      falhas = 0;
    }),
  };
}

const config = {
  get: jest.fn((key: string, fallback?: unknown) =>
    key === 'JWT_SECRET' ? SECRET : fallback,
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

describe('MfaService', () => {
  let estado: Estado;
  let repo: ReturnType<typeof criarRepositorio>;
  let limiter: ReturnType<typeof criarLimiter>;
  let revocation: { revokeAllSessions: jest.Mock };
  let service: MfaService;

  beforeEach(() => {
    jest.useRealTimers();
    estado = {
      id: 'user-1',
      email: 'dr@inexci.com',
      tokenVersion: 3,
      mfaSecret: null,
      mfaPendingSecret: null,
      mfaEnabledAt: null,
      mfaRecoveryCodes: null,
      mfaLastUsedStep: null,
    };
    repo = criarRepositorio(estado);
    limiter = criarLimiter();
    revocation = { revokeAllSessions: jest.fn().mockResolvedValue(undefined) };
    (bcryptjs.compare as jest.Mock).mockReset();
    service = new MfaService(
      repo as unknown as UserRepository,
      jwtService,
      config,
      limiter as unknown as AuthAttemptLimiter,
      revocation as unknown as SessionRevocationService,
    );
  });

  async function ativar(): Promise<{ secret: string; codes: string[] }> {
    const { secret } = await service.setup('user-1');
    const { recoveryCodes } = await service.enable(
      'user-1',
      generateTotp(secret, Date.now() - 30_000),
    );
    return { secret, codes: recoveryCodes };
  }

  describe('setup', () => {
    it('gera segredo pendente, chave formatada e URI otpauth com issuer Inexci', async () => {
      const result = await service.setup('user-1');

      expect(result.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(result.formattedSecret.replace(/ /g, '')).toBe(result.secret);
      expect(result.otpauthUri).toContain('otpauth://totp/Inexci:');
      expect(result.otpauthUri).toContain('issuer=Inexci');
      expect(result.otpauthUri).toContain(encodeURIComponent('dr@inexci.com'));
      expect(estado.mfaPendingSecret).toBe(result.secret);
      expect(estado.mfaSecret).toBeNull();
      expect(estado.mfaEnabledAt).toBeNull();
    });

    it('recusa quando o MFA já está ativo', async () => {
      await ativar();
      await expect(service.setup('user-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('enable', () => {
    it('ativa com código válido e devolve 10 códigos guardados só como hash', async () => {
      const { secret } = await service.setup('user-1');

      const { recoveryCodes } = await service.enable(
        'user-1',
        generateTotp(secret),
      );

      expect(recoveryCodes).toHaveLength(10);
      expect(estado.mfaSecret).toBe(secret);
      expect(estado.mfaPendingSecret).toBeNull();
      expect(estado.mfaEnabledAt).toBeInstanceOf(Date);
      expect(estado.mfaRecoveryCodes).toHaveLength(10);
      const pepper = deriveRecoveryPepper(SECRET);
      expect(estado.mfaRecoveryCodes).toEqual(
        recoveryCodes.map((c) => hashRecoveryCode(c, pepper)),
      );
      for (const codigo of recoveryCodes) {
        expect(estado.mfaRecoveryCodes).not.toContain(codigo);
      }
      expect(estado.mfaLastUsedStep).toBe(totpStepAt());
    });

    it('código errado não ativa e conta falha', async () => {
      await service.setup('user-1');

      await expect(service.enable('user-1', '000000')).rejects.toThrow(
        MFA_CODIGO_INVALIDO,
      );
      expect(estado.mfaEnabledAt).toBeNull();
      expect(limiter.registerMfaFailure).toHaveBeenCalledWith('user-1');
    });

    it('sem setup prévio pede para recomeçar', async () => {
      await expect(service.enable('user-1', '123456')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('o código usado na ativação não serve para o primeiro login (replay)', async () => {
      const { secret } = await service.setup('user-1');
      const codigo = generateTotp(secret);
      await service.enable('user-1', codigo);

      await expect(
        service.verifySecondFactor('user-1', codigo, { allowRecovery: true }),
      ).rejects.toThrow(MFA_CODIGO_INVALIDO);
    });
  });

  describe('verifySecondFactor', () => {
    it('aceita TOTP do passo atual e recusa o mesmo código de novo', async () => {
      const { secret } = await ativar();
      const codigo = generateTotp(secret);

      await expect(
        service.verifySecondFactor('user-1', codigo, { allowRecovery: true }),
      ).resolves.toBe('totp');
      await expect(
        service.verifySecondFactor('user-1', codigo, { allowRecovery: true }),
      ).rejects.toThrow(MFA_CODIGO_INVALIDO);
    });

    it('código de recuperação é de uso único', async () => {
      const { codes } = await ativar();

      await expect(
        service.verifySecondFactor('user-1', codes[3].toLowerCase(), {
          allowRecovery: true,
        }),
      ).resolves.toBe('recovery');
      expect(estado.mfaRecoveryCodes).toHaveLength(9);
      await expect(
        service.verifySecondFactor('user-1', codes[3], { allowRecovery: true }),
      ).rejects.toThrow(MFA_CODIGO_INVALIDO);
    });

    it('não aceita código de recuperação onde só TOTP é permitido', async () => {
      const { codes } = await ativar();
      await expect(
        service.verifySecondFactor('user-1', codes[0], {
          allowRecovery: false,
        }),
      ).rejects.toThrow(MFA_CODIGO_INVALIDO);
      expect(estado.mfaRecoveryCodes).toHaveLength(10);
    });

    it('5 falhas bloqueiam a conta (429) e o bloqueio vale mesmo com código certo', async () => {
      const { secret } = await ativar();

      for (let i = 0; i < 4; i++) {
        await expect(
          service.verifySecondFactor('user-1', '000000', {
            allowRecovery: true,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      const quinta = service.verifySecondFactor('user-1', '000000', {
        allowRecovery: true,
      });
      await expect(quinta).rejects.toThrow(MFA_BLOQUEADO);
      await expect(quinta).rejects.toBeInstanceOf(HttpException);

      const bloqueado = service.verifySecondFactor(
        'user-1',
        generateTotp(secret),
        { allowRecovery: true },
      );
      await expect(bloqueado).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
    });

    it('acerto zera o contador de falhas', async () => {
      const { secret } = await ativar();
      limiter.clearMfaFailures.mockClear();

      await service.verifySecondFactor('user-1', generateTotp(secret), {
        allowRecovery: true,
      });

      expect(limiter.clearMfaFailures).toHaveBeenCalledWith('user-1');
    });

    it('recusa quando o MFA não está ativo', async () => {
      await expect(
        service.verifySecondFactor('user-1', '123456', { allowRecovery: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('disable', () => {
    it('exige senha correta + código e revoga as sessões', async () => {
      const { secret } = await ativar();
      (bcryptjs.compare as jest.Mock).mockResolvedValue(true);

      await service.disable('user-1', 'Senha123@', generateTotp(secret));

      expect(estado.mfaEnabledAt).toBeNull();
      expect(estado.mfaSecret).toBeNull();
      expect(estado.mfaRecoveryCodes).toBeNull();
      expect(revocation.revokeAllSessions).toHaveBeenCalledWith(
        'user-1',
        'mfa_disabled',
      );
    });

    it('aceita código de recuperação', async () => {
      const { codes } = await ativar();
      (bcryptjs.compare as jest.Mock).mockResolvedValue(true);

      await service.disable('user-1', 'Senha123@', codes[0]);

      expect(estado.mfaEnabledAt).toBeNull();
    });

    it('senha errada não desativa, não revoga e conta falha', async () => {
      const { secret } = await ativar();
      (bcryptjs.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.disable('user-1', 'errada', generateTotp(secret)),
      ).rejects.toThrow('Senha atual incorreta');
      expect(estado.mfaEnabledAt).not.toBeNull();
      expect(revocation.revokeAllSessions).not.toHaveBeenCalled();
      expect(limiter.registerMfaFailure).toHaveBeenCalled();
    });

    it('código errado não desativa', async () => {
      await ativar();
      (bcryptjs.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.disable('user-1', 'Senha123@', '000000'),
      ).rejects.toThrow(MFA_CODIGO_INVALIDO);
      expect(estado.mfaEnabledAt).not.toBeNull();
      expect(revocation.revokeAllSessions).not.toHaveBeenCalled();
    });
  });

  describe('regenerateRecoveryCodes', () => {
    it('com TOTP válido troca os 10 códigos e invalida os antigos', async () => {
      const { secret, codes } = await ativar();

      const { recoveryCodes } = await service.regenerateRecoveryCodes(
        'user-1',
        generateTotp(secret),
      );

      expect(recoveryCodes).toHaveLength(10);
      expect(recoveryCodes).not.toEqual(codes);
      await expect(
        service.verifySecondFactor('user-1', codes[0], { allowRecovery: true }),
      ).rejects.toThrow(MFA_CODIGO_INVALIDO);
      await expect(
        service.verifySecondFactor('user-1', recoveryCodes[0], {
          allowRecovery: true,
        }),
      ).resolves.toBe('recovery');
    });

    it('código errado não troca nada', async () => {
      await ativar();
      const antes = [...(estado.mfaRecoveryCodes ?? [])];

      await expect(
        service.regenerateRecoveryCodes('user-1', '000000'),
      ).rejects.toThrow(MFA_CODIGO_INVALIDO);
      expect(estado.mfaRecoveryCodes).toEqual(antes);
    });
  });

  describe('token da segunda etapa', () => {
    it('carrega userId e tokenVersion e expira em 5 minutos', () => {
      const token = service.createLoginToken({ id: 'user-1', tokenVersion: 3 });
      const payload = jwtService.decode<{
        userId: string;
        tv: number;
        purpose: string;
        aud: string;
        exp: number;
        iat: number;
      }>(token);

      expect(payload.purpose).toBe('mfa');
      expect(payload.aud).toBe(`${JWT_DEFAULT_AUDIENCE}:mfa`);
      expect(payload.exp - payload.iat).toBe(300);
      expect(service.verifyLoginToken(token)).toEqual({
        userId: 'user-1',
        tv: 3,
      });
    });

    it('recusa um access token comum no lugar do token de MFA', () => {
      const access = jwtService.sign({ userId: 'user-1', tv: 3 });
      expect(() => service.verifyLoginToken(access)).toThrow(
        UnauthorizedException,
      );
    });

    it('recusa token expirado', () => {
      jest.useFakeTimers({ now: Date.now() });
      const token = service.createLoginToken({ id: 'user-1', tokenVersion: 3 });
      jest.setSystemTime(Date.now() + 6 * 60 * 1000);
      expect(() => service.verifyLoginToken(token)).toThrow(
        UnauthorizedException,
      );
      jest.useRealTimers();
    });

    it('recusa token adulterado', () => {
      const token = service.createLoginToken({ id: 'user-1', tokenVersion: 3 });
      expect(() => service.verifyLoginToken(`${token}x`)).toThrow(
        UnauthorizedException,
      );
    });
  });
});
