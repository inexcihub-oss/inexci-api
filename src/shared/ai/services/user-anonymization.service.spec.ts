import { Test, TestingModule } from '@nestjs/testing';
import { UserAnonymizationService } from './user-anonymization.service';
import { WhatsappConversationRepository } from '../../../database/repositories/whatsapp-conversation.repository';
import { WhatsappConversationMessageRepository } from '../../../database/repositories/whatsapp-conversation-message.repository';

describe('UserAnonymizationService', () => {
  let service: UserAnonymizationService;

  const mockConvRepo = {
    findMany: jest.fn(),
    getRepository: jest.fn().mockReturnValue({ update: jest.fn() }),
  };

  const mockMsgRepo = {
    findRecentByConversation: jest.fn(),
    getRepository: jest.fn().mockReturnValue({ update: jest.fn() }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserAnonymizationService,
        { provide: WhatsappConversationRepository, useValue: mockConvRepo },
        {
          provide: WhatsappConversationMessageRepository,
          useValue: mockMsgRepo,
        },
      ],
    }).compile();

    service = module.get<UserAnonymizationService>(UserAnonymizationService);
    jest.clearAllMocks();
    mockConvRepo.getRepository.mockReturnValue({ update: jest.fn() });
    mockMsgRepo.getRepository.mockReturnValue({ update: jest.fn() });
  });

  it('deve anonimizar conversas e mensagens do usuário', async () => {
    mockConvRepo.findMany.mockResolvedValue([
      { id: 'conv-1', phone: '+5511999999999' },
    ]);
    mockMsgRepo.findRecentByConversation.mockResolvedValue([
      { id: 'msg-1', content: 'Olá' },
      { id: 'msg-2', content: 'Resposta' },
    ]);

    await service.anonymizeUserData({ userId: 'user-1' });

    expect(mockConvRepo.findMany).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(mockConvRepo.getRepository().update).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        active: false,
        messagesHistory: [],
      }),
    );
    expect(mockMsgRepo.getRepository().update).toHaveBeenCalledTimes(2);
  });

  it('deve funcionar sem erro quando não há conversas', async () => {
    mockConvRepo.findMany.mockResolvedValue([]);

    await expect(
      service.anonymizeUserData({ userId: 'user-no-conv' }),
    ).resolves.toBeUndefined();
  });
});
