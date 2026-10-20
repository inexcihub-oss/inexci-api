import { ContestationRepository } from './contestation.repository';
import { ContestationTypeEnum } from '../entities/contestation.entity';

describe('ContestationRepository.findLatestBySurgeryRequest', () => {
  it('busca a contestação mais recente do tipo informado', async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const repo = new ContestationRepository({ findOne, metadata: {} } as any);

    await repo.findLatestBySurgeryRequest(
      'req-1',
      ContestationTypeEnum.AUTHORIZATION,
    );

    expect(findOne).toHaveBeenCalledWith({
      where: {
        surgeryRequestId: 'req-1',
        type: ContestationTypeEnum.AUTHORIZATION,
      },
      order: { createdAt: 'DESC' },
    });
  });
});
