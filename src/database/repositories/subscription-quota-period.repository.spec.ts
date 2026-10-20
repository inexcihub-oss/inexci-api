import { EntityManager, Repository } from 'typeorm';

import { SubscriptionQuotaPeriod } from '../entities/subscription-quota-period.entity';
import { SubscriptionQuotaPeriodRepository } from './subscription-quota-period.repository';

function buildUpdateBuilder(affected: number) {
  const builder: Record<string, jest.Mock> = {};
  builder.update = jest.fn().mockReturnValue(builder);
  builder.set = jest.fn().mockReturnValue(builder);
  builder.where = jest.fn().mockReturnValue(builder);
  builder.andWhere = jest.fn().mockReturnValue(builder);
  builder.execute = jest.fn().mockResolvedValue({ affected });
  return builder;
}

describe('SubscriptionQuotaPeriodRepository', () => {
  let defaultBuilder: ReturnType<typeof buildUpdateBuilder>;
  let defaultRepo: jest.Mocked<Repository<SubscriptionQuotaPeriod>>;
  let repository: SubscriptionQuotaPeriodRepository;

  beforeEach(() => {
    defaultBuilder = buildUpdateBuilder(1);
    defaultRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(defaultBuilder),
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<SubscriptionQuotaPeriod>>;
    repository = new SubscriptionQuotaPeriodRepository(defaultRepo);
  });

  describe('tryConsume', () => {
    it('usa o repositório padrão sem manager', async () => {
      await expect(repository.tryConsume('period-1')).resolves.toBe(true);
      expect(defaultRepo.createQueryBuilder).toHaveBeenCalled();
    });

    it('grava pelo manager da transação quando informado', async () => {
      const txBuilder = buildUpdateBuilder(1);
      const txRepo = {
        createQueryBuilder: jest.fn().mockReturnValue(txBuilder),
      };
      const manager = {
        getRepository: jest.fn().mockReturnValue(txRepo),
      } as unknown as EntityManager;

      await expect(repository.tryConsume('period-1', manager)).resolves.toBe(
        true,
      );

      expect(manager.getRepository).toHaveBeenCalledWith(
        SubscriptionQuotaPeriod,
      );
      expect(txBuilder.execute).toHaveBeenCalled();
      expect(defaultRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('devolve false quando nenhuma linha é afetada', async () => {
      defaultRepo.createQueryBuilder.mockReturnValue(
        buildUpdateBuilder(0) as never,
      );
      await expect(repository.tryConsume('period-1')).resolves.toBe(false);
    });
  });

  describe('findById', () => {
    it('lê pelo manager quando informado', async () => {
      const txRepo = { findOne: jest.fn().mockResolvedValue({ id: 'p' }) };
      const manager = {
        getRepository: jest.fn().mockReturnValue(txRepo),
      } as unknown as EntityManager;

      await repository.findById('p', manager);

      expect(txRepo.findOne).toHaveBeenCalledWith({ where: { id: 'p' } });
      expect(defaultRepo.findOne).not.toHaveBeenCalled();
    });
  });
});
