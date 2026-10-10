import { MoreThanOrEqual } from 'typeorm';
import { SurgeryRequestActivityRepository } from './surgery-request-activity.repository';
import { ActivityType } from '../entities/surgery-request-activity.entity';

describe('SurgeryRequestActivityRepository.findByTypeSince', () => {
  it('filtra por tipo e data mínima, da mais recente para a mais antiga', async () => {
    const find = jest.fn().mockResolvedValue([]);
    const repo = new SurgeryRequestActivityRepository({
      find,
      metadata: {},
    } as any);
    const desde = new Date('2026-10-01T10:00:00Z');

    await repo.findByTypeSince('req-1', ActivityType.PDF_GENERATED, desde);

    expect(find).toHaveBeenCalledWith({
      where: {
        surgeryRequestId: 'req-1',
        type: ActivityType.PDF_GENERATED,
        createdAt: MoreThanOrEqual(desde),
      },
      order: { createdAt: 'DESC' },
    });
  });
});
