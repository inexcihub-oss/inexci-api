import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import {
  MENTION_EMAILS_QUEUE,
  MentionEmailsJobsService,
  SEND_MENTION_EMAIL_JOB,
} from './mention-emails-jobs.service';

describe('MentionEmailsJobsService', () => {
  let service: MentionEmailsJobsService;
  let queue: { add: jest.Mock };

  const data = {
    mentionId: 'mention-1',
    surgeryRequestId: 'sc-1',
    authorName: 'Dra. Ana',
    content: 'confere o laudo',
  };

  beforeEach(async () => {
    queue = { add: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MentionEmailsJobsService,
        { provide: getQueueToken(MENTION_EMAILS_QUEUE), useValue: queue },
        { provide: ConfigService, useValue: { get: jest.fn(() => 10) } },
      ],
    }).compile();

    service = module.get(MentionEmailsJobsService);
  });

  it('enfileira com o atraso configurado, em milissegundos', async () => {
    await service.schedule(data);

    expect(queue.add).toHaveBeenCalledWith(
      SEND_MENTION_EMAIL_JOB,
      expect.objectContaining({ mentionId: 'mention-1' }),
      expect.objectContaining({ delay: 10 * 60 * 1000 }),
    );
  });

  it('não lança quando o Redis está fora — a menção já foi salva', async () => {
    queue.add.mockRejectedValue(new Error('redis fora do ar'));

    await expect(service.schedule(data)).resolves.toBeUndefined();
  });
});
