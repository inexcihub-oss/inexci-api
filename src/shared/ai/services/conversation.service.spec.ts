import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConversationService } from './conversation.service';
import { WhatsappConversationRepository } from '../../../database/repositories/whatsapp-conversation.repository';
import { WhatsappConversationMessageRepository } from '../../../database/repositories/whatsapp-conversation-message.repository';
import { WhatsappConversation } from '../../../database/entities/whatsapp-conversation.entity';

const mockConversationRepo = {
  findActiveByPhone: jest.fn(),
  deactivateOldConversations: jest.fn(),
  create: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
};

const mockMessageRepo = {
  create: jest.fn(),
  findRecentByConversation: jest.fn(),
};

const configServiceMock = {
  get: jest.fn((key: string, def?: any) => {
    const map: Record<string, any> = {
      AI_MAX_CONVERSATION_HISTORY: 20,
      AI_MAX_RECENT_MESSAGES: 10,
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
        {
          provide: WhatsappConversationMessageRepository,
          useValue: mockMessageRepo,
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
      userId: 'user-1',
      messagesHistory: [],
    } as unknown as WhatsappConversation;
    mockConversationRepo.create.mockResolvedValue(created);

    const result = await service.getOrCreateConversation(
      '+5511999999999',
      'user-1',
    );

    expect(mockConversationRepo.create).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('conv-1');
  });

  it('deve retornar conversa existente não expirada', async () => {
    const existing = {
      id: 'conv-existing',
      phone: '+5511999999999',
      userId: 'user-1',
      messagesHistory: [],
      lastMessageAt: new Date(),
      active: true,
    } as unknown as WhatsappConversation;
    mockConversationRepo.findActiveByPhone.mockResolvedValue(existing);

    const result = await service.getOrCreateConversation(
      '+5511999999999',
      'user-1',
    );

    expect(mockConversationRepo.create).not.toHaveBeenCalled();
    expect(result.id).toBe('conv-existing');
  });

  it('deve criar nova conversa quando expirada', async () => {
    const expired = {
      id: 'conv-expired',
      phone: '+5511999999999',
      messagesHistory: [],
      lastMessageAt: new Date(Date.now() - 60 * 60 * 1000),
      active: true,
    } as unknown as WhatsappConversation;
    mockConversationRepo.findActiveByPhone.mockResolvedValue(expired);
    mockConversationRepo.deactivateOldConversations.mockResolvedValue(
      undefined,
    );
    const newConv = {
      id: 'conv-new',
      messagesHistory: [],
    } as unknown as WhatsappConversation;
    mockConversationRepo.create.mockResolvedValue(newConv);

    const result = await service.getOrCreateConversation(
      '+5511999999999',
      'user-1',
    );

    expect(
      mockConversationRepo.deactivateOldConversations,
    ).toHaveBeenCalledTimes(1);
    expect(mockConversationRepo.create).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('conv-new');
  });

  it('deve construir mensagens OpenAI com histórico da tabela filha', () => {
    const conv = {
      id: 'conv-1',
      phone: '+5511999999999',
      userId: 'user-1',
      messagesHistory: [],
    } as unknown as WhatsappConversation;

    const recentMessages = [
      { role: 'user', content: 'Olá' },
      { role: 'assistant', content: 'Oi!' },
    ];

    const messages = service.buildMessagesForOpenAI(
      conv,
      undefined,
      recentMessages,
    );

    expect(messages[0].role).toBe('system');
    expect(messages.some((m) => m.role === 'user' && m.content === 'Olá')).toBe(
      true,
    );
    expect(
      messages.some((m) => m.role === 'assistant' && m.content === 'Oi!'),
    ).toBe(true);
  });

  it('deve fazer fallback para messagesHistory quando não há tabela filha', () => {
    const conv = {
      id: 'conv-1',
      phone: '+5511999999999',
      userId: 'user-1',
      messagesHistory: [
        { role: 'user', content: 'Olá', timestamp: '' },
        { role: 'assistant', content: 'Oi!', timestamp: '' },
      ],
    } as unknown as WhatsappConversation;

    const messages = service.buildMessagesForOpenAI(conv);

    expect(messages.some((m) => m.role === 'user' && m.content === 'Olá')).toBe(
      true,
    );
  });

  it('deve gravar na tabela filha e no jsonb ao appendMessage', async () => {
    mockConversationRepo.findOne.mockResolvedValue({
      id: 'conv-1',
      messagesHistory: [],
    } as unknown as WhatsappConversation);
    mockMessageRepo.create.mockResolvedValue({});
    mockConversationRepo.update.mockResolvedValue({});

    await service.appendMessage('conv-1', 'user', 'Olá');

    expect(mockMessageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        role: 'user',
        content: 'Olá',
      }),
    );
    expect(mockConversationRepo.update).toHaveBeenCalledTimes(1);
  });

  it('deve limpar histórico, summary e memory ao resetar contexto', async () => {
    mockConversationRepo.findOne.mockResolvedValue({
      id: 'conv-1',
      messagesHistory: [{ role: 'user', content: 'Olá', timestamp: '' }],
      conversationSummary: 'algum resumo',
      conversationMemory: { intent: 'consulta' },
      summaryUpdatedAt: new Date(),
    } as unknown as WhatsappConversation);

    await service.resetConversationHistory('conv-1');

    expect(mockConversationRepo.update).toHaveBeenCalledTimes(1);
    expect(mockConversationRepo.update).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        messagesHistory: [],
        conversationSummary: null,
        conversationMemory: {},
        summaryUpdatedAt: null,
      }),
    );
  });

  it('loadRecentForLlm aplica AI_MAX_RECENT_MESSAGES (default 10)', async () => {
    mockMessageRepo.findRecentByConversation.mockResolvedValue([
      { role: 'user', content: 'Oi', createdAt: new Date() },
    ]);

    await service.loadRecentForLlm('conv-1');

    expect(mockMessageRepo.findRecentByConversation).toHaveBeenCalledWith(
      'conv-1',
      10,
    );
  });

  it('deve carregar mensagens recentes da tabela filha (T24)', async () => {
    mockMessageRepo.findRecentByConversation.mockResolvedValue([
      { role: 'user', content: 'Oi', createdAt: new Date() },
      { role: 'assistant', content: 'Olá!', createdAt: new Date() },
    ]);

    const messages = await service.loadRecentMessages('conv-1');

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(mockMessageRepo.findRecentByConversation).toHaveBeenCalledWith(
      'conv-1',
      20,
    );
  });
});
