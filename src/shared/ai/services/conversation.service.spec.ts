import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConversationService } from './conversation.service';
import { WhatsappConversationRepository } from '../../../database/repositories/whatsapp-conversation.repository';
import { WhatsappConversation } from '../../../database/entities/whatsapp-conversation.entity';

const mockConversationRepo = {
  findActiveByPhone: jest.fn(),
  deactivateOldConversations: jest.fn(),
  create: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
};

const configServiceMock = {
  get: jest.fn((key: string, def?: any) => {
    const map: Record<string, any> = {
      AI_MAX_CONVERSATION_HISTORY: 20,
      AI_SESSION_TIMEOUT_MINUTES: 30,
    };
    return map[key] ?? def;
  }),
};

describe('ConversationService', () => {
  let service: ConversationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationService,
        {
          provide: WhatsappConversationRepository,
          useValue: mockConversationRepo,
        },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get<ConversationService>(ConversationService);
    jest.clearAllMocks();
  });

  it('deve criar nova conversa quando não existe', async () => {
    mockConversationRepo.findActiveByPhone.mockResolvedValue(null);
    const created = {
      id: 'conv-1',
      phone: '+5511999999999',
      user_id: 'user-1',
      messages_history: [],
    } as unknown as WhatsappConversation;
    mockConversationRepo.create.mockResolvedValue(created);

    const result = await service.getOrCreateConversation('+5511999999999', 'user-1');

    expect(mockConversationRepo.create).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('conv-1');
  });

  it('deve retornar conversa existente não expirada', async () => {
    const existing = {
      id: 'conv-existing',
      phone: '+5511999999999',
      user_id: 'user-1',
      messages_history: [],
      last_message_at: new Date(),
      active: true,
    } as unknown as WhatsappConversation;
    mockConversationRepo.findActiveByPhone.mockResolvedValue(existing);

    const result = await service.getOrCreateConversation('+5511999999999', 'user-1');

    expect(mockConversationRepo.create).not.toHaveBeenCalled();
    expect(result.id).toBe('conv-existing');
  });

  it('deve criar nova conversa quando expirada', async () => {
    const expired = {
      id: 'conv-expired',
      phone: '+5511999999999',
      messages_history: [],
      last_message_at: new Date(Date.now() - 60 * 60 * 1000), // 1 hora atrás
      active: true,
    } as unknown as WhatsappConversation;
    mockConversationRepo.findActiveByPhone.mockResolvedValue(expired);
    mockConversationRepo.deactivateOldConversations.mockResolvedValue(undefined);
    const newConv = { id: 'conv-new', messages_history: [] } as unknown as WhatsappConversation;
    mockConversationRepo.create.mockResolvedValue(newConv);

    const result = await service.getOrCreateConversation('+5511999999999', 'user-1');

    expect(mockConversationRepo.deactivateOldConversations).toHaveBeenCalledTimes(1);
    expect(mockConversationRepo.create).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('conv-new');
  });

  it('deve construir mensagens OpenAI com histórico', () => {
    const conv = {
      id: 'conv-1',
      phone: '+5511999999999',
      user_id: 'user-1',
      messages_history: [
        { role: 'user', content: 'Olá', timestamp: '' },
        { role: 'assistant', content: 'Oi!', timestamp: '' },
      ],
    } as unknown as WhatsappConversation;

    const messages = service.buildMessagesForOpenAI(conv);

    expect(messages[0].role).toBe('system');
    expect(messages.some((m) => m.role === 'user' && m.content === 'Olá')).toBe(true);
    expect(messages.some((m) => m.role === 'assistant' && m.content === 'Oi!')).toBe(true);
  });
});
