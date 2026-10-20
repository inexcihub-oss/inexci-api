import { IsNull, Repository } from 'typeorm';

import {
  RecoveryCode,
  RecoveryCodePurpose,
} from '../entities/recovery-code.entity';
import { RecoveryCodeRepository } from './recovery-code.repository';

function buildUpdateBuilder(raw: unknown) {
  const builder: Record<string, jest.Mock> = {};
  builder.update = jest.fn().mockReturnValue(builder);
  builder.set = jest.fn().mockReturnValue(builder);
  builder.where = jest.fn().mockReturnValue(builder);
  builder.andWhere = jest.fn().mockReturnValue(builder);
  builder.setParameters = jest.fn().mockReturnValue(builder);
  builder.returning = jest.fn().mockReturnValue(builder);
  builder.execute = jest.fn().mockResolvedValue({ raw });
  return builder;
}

describe('RecoveryCodeRepository', () => {
  let builder: ReturnType<typeof buildUpdateBuilder>;
  let repo: jest.Mocked<Repository<RecoveryCode>>;
  let repository: RecoveryCodeRepository;

  beforeEach(() => {
    builder = buildUpdateBuilder([{ attempts: 3 }]);
    repo = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
      findOne: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<Repository<RecoveryCode>>;
    repository = new RecoveryCodeRepository(repo);
  });

  describe('consumeAttempt', () => {
    it('incrementa no próprio UPDATE, condicionado a não usado e abaixo do limite', async () => {
      await expect(repository.consumeAttempt('rec-1', 5)).resolves.toBe(3);

      const set = builder.set.mock.calls[0][0] as Record<string, () => string>;
      expect(set.attempts()).toBe('"attempts" + 1');
      expect(set.used()).toBe('("attempts" + 1 >= :maxAttempts)');
      expect(builder.where).toHaveBeenCalledWith('"id" = :id', { id: 'rec-1' });
      expect(builder.andWhere).toHaveBeenCalledWith('"used" = false');
      expect(builder.andWhere).toHaveBeenCalledWith(
        '"attempts" < :maxAttempts',
      );
      expect(builder.setParameters).toHaveBeenCalledWith({ maxAttempts: 5 });
      expect(builder.returning).toHaveBeenCalledWith(['attempts']);
    });

    it('devolve null quando nenhuma linha voltou (já usado ou no limite)', async () => {
      repo.createQueryBuilder.mockReturnValue(buildUpdateBuilder([]) as never);
      await expect(repository.consumeAttempt('rec-1', 5)).resolves.toBeNull();
    });

    it('devolve null quando o driver não traz linhas', async () => {
      repo.createQueryBuilder.mockReturnValue(
        buildUpdateBuilder(undefined) as never,
      );
      await expect(repository.consumeAttempt('rec-1', 5)).resolves.toBeNull();
    });
  });

  describe('issueResetToken', () => {
    it('só grava o reset token se nenhum outro foi emitido para o código', async () => {
      repo.update.mockResolvedValue({ affected: 1 } as never);
      const expira = new Date();

      await expect(
        repository.issueResetToken('rec-1', 'tok', expira),
      ).resolves.toBe(true);

      expect(repo.update).toHaveBeenCalledWith(
        { id: 'rec-1', resetToken: IsNull() },
        { used: true, resetToken: 'tok', resetTokenExpiresAt: expira },
      );
    });

    it('devolve false quando a corrida já foi vencida por outra requisição', async () => {
      repo.update.mockResolvedValue({ affected: 0 } as never);
      await expect(
        repository.issueResetToken('rec-1', 'tok', new Date()),
      ).resolves.toBe(false);
    });
  });

  describe('findActive', () => {
    it('busca o código não usado mais recente do tipo pedido', async () => {
      await repository.findActive('user-1', RecoveryCodePurpose.INVITE);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          purpose: RecoveryCodePurpose.INVITE,
          used: false,
        },
        order: { createdAt: 'DESC' },
      });
    });
  });
});
