import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { SurgeryRequestActivityRepository } from 'src/database/repositories/surgery-request-activity.repository';
import { SurgeryRequestActivityMentionRepository } from 'src/database/repositories/surgery-request-activity-mention.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { StorageService } from 'src/shared/storage/storage.service';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { ActivityMentionsService } from './mentions/activity-mentions.service';

describe('ActivitiesService', () => {
  let module: TestingModule;
  let service: ActivitiesService;
  let accessControl: { getUsersWithAccessToDoctor: jest.Mock };
  let surgeryRequestRepository: { findOneSimple: jest.Mock };
  let userRepository: { findOne: jest.Mock };

  beforeEach(async () => {
    accessControl = { getUsersWithAccessToDoctor: jest.fn() };
    surgeryRequestRepository = {
      findOneSimple: jest.fn().mockResolvedValue({
        id: 'sc-1',
        doctorId: 'doc-1',
        ownerId: 'owner-1',
      }),
    };
    userRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'user-1',
        name: 'Autor',
        ownerId: 'owner-1',
        avatarUrl: null,
      }),
    };

    module = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        {
          provide: SurgeryRequestActivityRepository,
          useValue: {
            create: jest.fn(),
            findBySurgeryRequest: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: SurgeryRequestActivityMentionRepository,
          useValue: { findByActivityIds: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: SurgeryRequestRepository,
          useValue: surgeryRequestRepository,
        },
        { provide: UserRepository, useValue: userRepository },
        { provide: StorageService, useValue: { getSignedUrl: jest.fn() } },
        { provide: AccessControlService, useValue: accessControl },
        {
          provide: ActivityMentionsService,
          useValue: { register: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();

    service = module.get(ActivitiesService);
  });

  describe('findMentionableUsers', () => {
    it('devolve quem acessa a SC sem o próprio autor', async () => {
      accessControl.getUsersWithAccessToDoctor.mockResolvedValue([
        { id: 'user-1', name: 'Autor', avatarUrl: null },
        { id: 'user-2', name: 'Dra. Ana', avatarUrl: 'avatars/ana.png' },
      ]);

      const result = await service.findMentionableUsers('sc-1', 'user-1');

      expect(accessControl.getUsersWithAccessToDoctor).toHaveBeenCalledWith(
        'doc-1',
        'owner-1',
      );
      expect(result).toEqual([
        { id: 'user-2', name: 'Dra. Ana', avatarUrl: 'avatars/ana.png' },
      ]);
    });

    it('recusa quando a solicitação não existe', async () => {
      surgeryRequestRepository.findOneSimple.mockResolvedValue(null);

      await expect(
        service.findMentionableUsers('sc-inexistente', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
  describe('create', () => {
    it('registra as menções e devolve os mencionados', async () => {
      const activityRepository = module.get(SurgeryRequestActivityRepository);
      (activityRepository.create as jest.Mock).mockResolvedValue({
        id: 'act-1',
        type: 'comment',
        content: '@Dr. Bruno confere?',
        createdAt: new Date('2026-09-22T12:00:00Z'),
      });
      const mentionsService = module.get(ActivityMentionsService);
      (mentionsService.register as jest.Mock).mockResolvedValue([
        { id: 'user-2', name: 'Dr. Bruno' },
      ]);

      const result = await service.create(
        'sc-1',
        { content: '@Dr. Bruno confere?', mentionedUserIds: ['user-2'] },
        'user-1',
      );

      expect(mentionsService.register).toHaveBeenCalledWith(
        expect.objectContaining({
          activityId: 'act-1',
          surgeryRequestId: 'sc-1',
          doctorUserId: 'doc-1',
          ownerId: 'owner-1',
          authorId: 'user-1',
          authorName: 'Autor',
          mentionedUserIds: ['user-2'],
        }),
      );
      expect(result.mentions).toEqual([{ id: 'user-2', name: 'Dr. Bruno' }]);
    });
  });
});
