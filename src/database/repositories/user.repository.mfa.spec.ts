import { getMetadataArgsStorage } from 'typeorm';
import { instanceToPlain } from 'class-transformer';
import { User } from '../entities/user.entity';
import { encryptedTransformer } from '../../shared/crypto/encryption.util';
import { UserRepository } from './user.repository';

function coluna(propriedade: string) {
  return getMetadataArgsStorage().columns.find(
    (c) => c.target === User && c.propertyName === propriedade,
  );
}

function criarQueryBuilder(affected = 1) {
  const qb = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected }),
  };
  return qb;
}

function buildRepo(affected = 1) {
  const qb = criarQueryBuilder(affected);
  const mockRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(() => qb),
  };
  return {
    repo: new UserRepository(mockRepository as never),
    mockRepository,
    qb,
  };
}

describe('User — colunas de MFA', () => {
  it.each(['mfaSecret', 'mfaPendingSecret'])(
    '%s é cifrado em repouso (AES-GCM) e nunca selecionado por padrão',
    (prop) => {
      const c = coluna(prop);
      expect(c?.options.transformer).toBe(encryptedTransformer);
      expect(c?.options.type).toBe('text');
      expect(c?.options.select).toBe(false);
    },
  );

  it.each(['mfaEnabledAt', 'mfaRecoveryCodes', 'mfaLastUsedStep'])(
    '%s não é selecionado por padrão',
    (prop) => {
      expect(coluna(prop)?.options.select).toBe(false);
    },
  );

  it('nenhum campo de MFA sai na serialização', () => {
    const user = Object.assign(new User(), {
      id: 'u-1',
      mfaSecret: 'S',
      mfaPendingSecret: 'P',
      mfaEnabledAt: new Date(),
      mfaRecoveryCodes: ['h'],
      mfaLastUsedStep: 1,
    });
    const plain = instanceToPlain(user);
    expect(plain.id).toBe('u-1');
    for (const prop of [
      'mfaSecret',
      'mfaPendingSecret',
      'mfaEnabledAt',
      'mfaRecoveryCodes',
      'mfaLastUsedStep',
    ]) {
      expect(plain).not.toHaveProperty(prop);
    }
  });
});

describe('UserRepository — MFA', () => {
  it('isMfaEnabled só seleciona o necessário', async () => {
    const { repo, mockRepository } = buildRepo();
    mockRepository.findOne.mockResolvedValue({
      id: 'u-1',
      mfaEnabledAt: new Date(),
    });

    await expect(repo.isMfaEnabled('u-1')).resolves.toBe(true);
    expect(mockRepository.findOne.mock.calls[0][0].select).toEqual({
      id: true,
      mfaEnabledAt: true,
    });
  });

  it('enableMfa só ativa quem ainda não tem MFA', async () => {
    const { repo, qb } = buildRepo(0);

    await expect(
      repo.enableMfa('u-1', {
        secret: 'S',
        recoveryCodeHashes: ['h'],
        usedStep: 10,
      }),
    ).resolves.toBe(false);
    expect(qb.andWhere).toHaveBeenCalledWith('mfa_enabled_at IS NULL');
    expect(qb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        mfaSecret: 'S',
        mfaPendingSecret: null,
        mfaRecoveryCodes: ['h'],
        mfaLastUsedStep: 10,
      }),
    );
  });

  it('consumeMfaStep é condicional ao passo anterior (anti-replay atômico)', async () => {
    const { repo, qb } = buildRepo(1);

    await expect(repo.consumeMfaStep('u-1', 42)).resolves.toBe(true);
    expect(qb.set).toHaveBeenCalledWith({ mfaLastUsedStep: 42 });
    expect(qb.andWhere).toHaveBeenCalledWith(
      '(mfa_last_used_step IS NULL OR mfa_last_used_step < :step)',
      { step: 42 },
    );
  });

  it('consumeMfaStep sem linha afetada é replay', async () => {
    const { repo } = buildRepo(0);
    await expect(repo.consumeMfaStep('u-1', 42)).resolves.toBe(false);
  });

  it('consumeMfaRecoveryCode remove o hash só se ele ainda estiver lá', async () => {
    const { repo, qb } = buildRepo(1);

    await expect(repo.consumeMfaRecoveryCode('u-1', 'abc')).resolves.toBe(true);
    expect(qb.andWhere).toHaveBeenCalledWith(
      ':codeHash = ANY(mfa_recovery_codes)',
    );
    expect(qb.setParameter).toHaveBeenCalledWith('codeHash', 'abc');
    const set = qb.set.mock.calls[0][0] as {
      mfaRecoveryCodes: () => string;
    };
    expect(set.mfaRecoveryCodes()).toBe(
      'array_remove(mfa_recovery_codes, :codeHash)',
    );
  });

  it('disableMfa zera todos os campos', async () => {
    const { repo, qb } = buildRepo(1);

    await repo.disableMfa('u-1');

    expect(qb.set).toHaveBeenCalledWith({
      mfaSecret: null,
      mfaPendingSecret: null,
      mfaEnabledAt: null,
      mfaRecoveryCodes: null,
      mfaLastUsedStep: null,
    });
  });
});
