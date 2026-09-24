import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { SurgeryRequestActivityMention } from '../entities/surgery-request-activity-mention.entity';
import { SurgeryRequestActivityMentionRepository } from './surgery-request-activity-mention.repository';

describe('SurgeryRequestActivityMentionRepository', () => {
  let repository: SurgeryRequestActivityMentionRepository;
  let typeorm: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(async () => {
    typeorm = {
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve(data)),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SurgeryRequestActivityMentionRepository,
        {
          provide: getRepositoryToken(SurgeryRequestActivityMention),
          useValue: typeorm,
        },
      ],
    }).compile();

    repository = module.get(SurgeryRequestActivityMentionRepository);
  });

  describe('createMany', () => {
    it('grava uma linha por usuário mencionado', async () => {
      await repository.createMany('act-1', ['user-1', 'user-2']);

      expect(typeorm.save).toHaveBeenCalledWith([
        { activityId: 'act-1', mentionedUserId: 'user-1' },
        { activityId: 'act-1', mentionedUserId: 'user-2' },
      ]);
    });

    it('não vai ao banco quando não há ninguém mencionado', async () => {
      const result = await repository.createMany('act-1', []);

      expect(result).toEqual([]);
      expect(typeorm.save).not.toHaveBeenCalled();
    });
  });

  describe('findByActivityIds', () => {
    it('busca as menções das atividades com o usuário mencionado', async () => {
      await repository.findByActivityIds(['act-1', 'act-2']);

      expect(typeorm.find).toHaveBeenCalledWith({
        where: { activityId: In(['act-1', 'act-2']) },
        relations: ['mentionedUser'],
      });
    });

    it('não vai ao banco com lista vazia', async () => {
      const result = await repository.findByActivityIds([]);

      expect(result).toEqual([]);
      expect(typeorm.find).not.toHaveBeenCalled();
    });
  });

  describe('markEmailSent', () => {
    it('carimba a data de envio', async () => {
      await repository.markEmailSent('mention-1');

      expect(typeorm.update).toHaveBeenCalledWith(
        'mention-1',
        expect.objectContaining({ emailSentAt: expect.any(Date) }),
      );
    });
  });

  describe('setNotificationId', () => {
    it('liga a menção à notificação criada', async () => {
      await repository.setNotificationId('mention-1', 'notif-1');

      expect(typeorm.update).toHaveBeenCalledWith('mention-1', {
        notificationId: 'notif-1',
      });
    });
  });
});
