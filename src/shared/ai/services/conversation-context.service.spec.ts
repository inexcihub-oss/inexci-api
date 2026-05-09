import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ConversationContextService,
  estimateTokens,
} from './conversation-context.service';
import { OpenaiService } from './openai.service';
import { PiiVaultService } from './pii-vault.service';
import { WhatsappConversationRepository } from '../../../database/repositories/whatsapp-conversation.repository';
import { WhatsappConversationMessageRepository } from '../../../database/repositories/whatsapp-conversation-message.repository';
import { WhatsappConversation } from '../../../database/entities/whatsapp-conversation.entity';

const mockOpenaiService = {
  chatCompletion: jest.fn(),
};

const mockConversationRepo = {
  findOne: jest.fn(),
  update: jest.fn(),
};

const mockMessageRepo = {
  findRecentByConversation: jest.fn(),
};

const mockPiiVault = {
  detectResidualPii: jest.fn().mockReturnValue([]),
  tokenize: jest.fn(
    (_sessionId: string, value: string, category: string) =>
      `{{${category}_1}}` + (value ? '' : ''),
  ),
};

function buildConversation(
  override: Partial<WhatsappConversation> = {},
): WhatsappConversation {
  return {
    id: 'conv-1',
    phone: '+5511999999999',
    userId: 'user-1',
    accountId: 'acc-1',
    startedAt: new Date(),
    lastMessageAt: new Date(),
    conversationSummary: null,
    conversationMemory: {},
    summaryUpdatedAt: null,
    summaryVersion: 1,
    active: true,
    createdAt: new Date(),
    user: null as any,
    ...override,
  } as unknown as WhatsappConversation;
}

function buildConfig(overrides: Record<string, any> = {}): ConfigService {
  const map: Record<string, any> = {
    AI_MAX_RECENT_MESSAGES: 4,
    AI_CONTEXT_TOKEN_BUDGET: 2200,
    AI_SUMMARY_TRIGGER_EVERY_MESSAGES: 5,
    AI_SUMMARY_MAX_TOKENS: 450,
    ...overrides,
  };
  return {
    get: jest.fn((key: string, def?: any) => map[key] ?? def),
  } as unknown as ConfigService;
}

describe('ConversationContextService', () => {
  let service: ConversationContextService;

  function makeService(configOverrides: Record<string, any> = {}) {
    return Test.createTestingModule({
      providers: [
        ConversationContextService,
        { provide: OpenaiService, useValue: mockOpenaiService },
        {
          provide: WhatsappConversationRepository,
          useValue: mockConversationRepo,
        },
        {
          provide: WhatsappConversationMessageRepository,
          useValue: mockMessageRepo,
        },
        { provide: PiiVaultService, useValue: mockPiiVault },
        { provide: ConfigService, useValue: buildConfig(configOverrides) },
      ],
    }).compile();
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPiiVault.detectResidualPii.mockReturnValue([]);
    mockPiiVault.tokenize.mockImplementation(
      (_sessionId: string, _value: string, category: string) =>
        `{{${category}_1}}`,
    );
    const module: TestingModule = await makeService();
    service = module.get<ConversationContextService>(
      ConversationContextService,
    );
  });

  describe('estimateTokens', () => {
    it('retorna 0 para vazio', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens(undefined)).toBe(0);
    });

    it('aproxima 1 token a cada 4 caracteres', () => {
      expect(estimateTokens('abcdefgh')).toBe(2);
    });
  });

  describe('buildContext (circuit breaker)', () => {
    it('degrada para history_only após 3 falhas consecutivas do sumarizador', async () => {
      mockMessageRepo.findRecentByConversation.mockResolvedValue([
        { role: 'user', content: 'Oi', createdAt: new Date() },
      ]);

      const result = await service.buildContext({
        conversation: buildConversation({
          conversationSummary: 'resumo antigo',
          conversationMemory: { intent: 'consulta', summary_failures: 3 },
        }),
      });

      expect(result.strategy).toBe('history_only');
      expect(result.breakdown.summary_tokens).toBe(0);
      expect(result.breakdown.memory_tokens).toBe(0);
      expect(
        result.messages.some((m) =>
          (m.content as string)?.startsWith?.('RESUMO DA CONVERSA'),
        ),
      ).toBe(false);
    });
  });

  describe('buildContext (hybrid)', () => {
    it('limita janela recente a AI_MAX_RECENT_MESSAGES', async () => {
      mockMessageRepo.findRecentByConversation.mockResolvedValue(
        Array.from({ length: 20 }).map((_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `msg ${i}`,
          createdAt: new Date(Date.now() + i),
        })),
      );

      const result = await service.buildContext({
        conversation: buildConversation(),
      });

      // Default test config: AI_MAX_RECENT_MESSAGES = 4
      expect(result.recentCount).toBe(4);
    });

    it('inclui summary e memory quando presentes', async () => {
      mockMessageRepo.findRecentByConversation.mockResolvedValue([]);
      const conv = buildConversation({
        conversationSummary: 'paciente Maria, hospital X',
        conversationMemory: {
          intent: 'criar_sc',
          patient: { id: 'p1' },
          last_updated_at: new Date().toISOString(),
        },
      });

      const result = await service.buildContext({ conversation: conv });

      expect(result.breakdown.summary_tokens).toBeGreaterThan(0);
      expect(result.breakdown.memory_tokens).toBeGreaterThan(0);
      expect(
        result.messages.some((m) =>
          (m.content as string)?.includes('paciente Maria'),
        ),
      ).toBe(true);
      expect(
        result.messages.some((m) =>
          (m.content as string)?.includes('"intent":"criar_sc"'),
        ),
      ).toBe(true);
    });

    it('respeita orçamento (corta RAG primeiro, depois mensagens antigas, depois summary)', async () => {
      const longContent = 'x'.repeat(8000);
      mockMessageRepo.findRecentByConversation.mockResolvedValue([
        { role: 'user', content: longContent, createdAt: new Date() },
        { role: 'assistant', content: longContent, createdAt: new Date() },
      ]);

      const result = await service.buildContext({
        conversation: buildConversation({
          conversationSummary: 'resumo curto',
        }),
        ragContext: 'rag pesado: ' + 'y'.repeat(8000),
      });

      expect(result.breakdown.rag_tokens).toBe(0);
      expect(result.breakdown.totalTokens).toBeLessThanOrEqual(
        2200 + estimateTokens(longContent), // último par sempre preservado
      );
    });

    it('tokeniza o telefone do usuário no bloco USUÁRIO ATUAL (regressão LGPD)', async () => {
      mockMessageRepo.findRecentByConversation.mockResolvedValue([]);
      const conv = buildConversation({ phone: '+5531989085791' });

      const result = await service.buildContext({ conversation: conv });

      const userBlock = result.messages.find(
        (m) =>
          typeof m.content === 'string' &&
          m.content.startsWith('USUÁRIO ATUAL'),
      );
      expect(userBlock).toBeDefined();
      const userBlockContent = userBlock?.content as string;
      expect(userBlockContent).not.toContain('+5531989085791');
      expect(userBlockContent).toContain('{{phone_1}}');
      expect(mockPiiVault.tokenize).toHaveBeenCalledWith(
        'conv-1',
        '+5531989085791',
        'phone',
      );
    });

    it('não inclui campo de telefone quando conversation.phone está vazio', async () => {
      mockMessageRepo.findRecentByConversation.mockResolvedValue([]);
      const conv = buildConversation({ phone: '' });

      const result = await service.buildContext({ conversation: conv });

      const userBlock = result.messages.find(
        (m) =>
          typeof m.content === 'string' &&
          m.content.startsWith('USUÁRIO ATUAL'),
      );
      expect(userBlock?.content).toBe('USUÁRIO ATUAL: ID=user-1');
    });

    it('não corta system prompt nem memory mesmo sob orçamento apertado', async () => {
      const longContent = 'a'.repeat(20000);
      mockMessageRepo.findRecentByConversation.mockResolvedValue([
        { role: 'user', content: longContent, createdAt: new Date() },
      ]);

      const result = await service.buildContext({
        conversation: buildConversation({
          conversationMemory: {
            intent: 'criar_sc',
            patient: { id: 'p1' },
          },
          conversationSummary: 'resumo',
        }),
      });

      expect(result.breakdown.system_tokens).toBeGreaterThan(0);
      expect(result.breakdown.memory_tokens).toBeGreaterThan(0);
    });
  });

  describe('shouldRefreshSummary', () => {
    it('dispara quando há >= AI_SUMMARY_TRIGGER_EVERY_MESSAGES novas mensagens', async () => {
      mockMessageRepo.findRecentByConversation.mockResolvedValue(
        Array.from({ length: 6 }).map(() => ({
          role: 'user',
          content: 'msg',
          createdAt: new Date(),
        })),
      );
      const result = await service.shouldRefreshSummary(buildConversation());
      expect(result).toBe(true);
    });

    it('não dispara depois de 3 falhas consecutivas (fallback automático)', async () => {
      mockMessageRepo.findRecentByConversation.mockResolvedValue(
        Array.from({ length: 10 }).map(() => ({
          role: 'user',
          content: 'msg',
          createdAt: new Date(),
        })),
      );
      const result = await service.shouldRefreshSummary(
        buildConversation({
          conversationMemory: { summary_failures: 3 },
        }),
      );
      expect(result).toBe(false);
    });

    it('dispara quando intent muda', async () => {
      mockMessageRepo.findRecentByConversation.mockResolvedValue([
        { role: 'user', content: 'oi', createdAt: new Date() },
      ]);
      const result = await service.shouldRefreshSummary(
        buildConversation({
          conversationMemory: { intent: 'consulta' },
        }),
        'criar_sc',
      );
      expect(result).toBe(true);
    });
  });

  describe('updateSummaryAndMemory', () => {
    it('atualiza summary + memory quando LLM retorna JSON válido', async () => {
      mockConversationRepo.findOne.mockResolvedValue(buildConversation());
      mockMessageRepo.findRecentByConversation.mockResolvedValue([
        { role: 'user', content: 'criar SC', createdAt: new Date() },
      ]);
      mockOpenaiService.chatCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: 'usuário quer criar SC',
                memory: { intent: 'criar_sc' },
              }),
            },
          },
        ],
      });

      await service.updateSummaryAndMemory('conv-1');

      expect(mockConversationRepo.update).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          conversationSummary: 'usuário quer criar SC',
          conversationMemory: expect.objectContaining({
            intent: 'criar_sc',
            summary_failures: 0,
          }),
        }),
      );
    });

    it('preserva tokens de PII pseudonimizada no summary gerado', async () => {
      mockConversationRepo.findOne.mockResolvedValue(buildConversation());
      mockMessageRepo.findRecentByConversation.mockResolvedValue([
        { role: 'user', content: 'paciente {{cpf_1}}', createdAt: new Date() },
      ]);
      mockOpenaiService.chatCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: 'usuário cita paciente {{cpf_1}}',
                memory: { intent: 'consulta' },
              }),
            },
          },
        ],
      });

      await service.updateSummaryAndMemory('conv-1');

      const updateCall = mockConversationRepo.update.mock.calls[0];
      expect(updateCall[1].conversationSummary).toContain('{{cpf_1}}');
    });

    it('rejeita summary com PII residual e incrementa contador de falhas', async () => {
      mockConversationRepo.findOne.mockResolvedValue(buildConversation());
      mockMessageRepo.findRecentByConversation.mockResolvedValue([
        { role: 'user', content: 'msg', createdAt: new Date() },
      ]);
      mockOpenaiService.chatCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: 'CPF 12345678901',
                memory: {},
              }),
            },
          },
        ],
      });
      mockPiiVault.detectResidualPii.mockReturnValueOnce([
        { category: 'cpf', sample: '12345678901' },
      ]);

      await service.updateSummaryAndMemory('conv-1');

      const updateCall = mockConversationRepo.update.mock.calls[0];
      expect(updateCall[1].conversationMemory.summary_failures).toBe(1);
      expect(updateCall[1].conversationSummary).toBeUndefined();
    });

    it('incrementa contador de falhas quando JSON é inválido', async () => {
      mockConversationRepo.findOne.mockResolvedValue(buildConversation());
      mockMessageRepo.findRecentByConversation.mockResolvedValue([
        { role: 'user', content: 'msg', createdAt: new Date() },
      ]);
      mockOpenaiService.chatCompletion.mockResolvedValue({
        choices: [{ message: { content: 'não é json' } }],
      });

      await service.updateSummaryAndMemory('conv-1');

      const updateCall = mockConversationRepo.update.mock.calls[0];
      expect(updateCall[1].conversationMemory.summary_failures).toBe(1);
    });
  });

  describe('trimRecentMessages', () => {
    it('preserva últimas N mensagens', () => {
      const msgs = Array.from({ length: 20 }).map((_, i) => ({
        role: 'user',
        content: `msg ${i}`,
      }));
      const trimmed = service.trimRecentMessages(msgs, 5);
      expect(trimmed.length).toBe(5);
      expect(trimmed[0].content).toBe('msg 15');
    });
  });

  describe('enforceTokenBudget', () => {
    it('corta na ordem rag → recent → summary', () => {
      const blocks = [
        { kind: 'system' as const, content: 's'.repeat(40) },
        { kind: 'memory' as const, content: 'm'.repeat(40) },
        { kind: 'summary' as const, content: 'r'.repeat(80) },
        { kind: 'rag' as const, content: 'g'.repeat(200) },
        { kind: 'recent' as const, content: 'a'.repeat(80) },
        { kind: 'recent' as const, content: 'b'.repeat(80) },
      ];
      const { blocks: out, droppedKinds } = service.enforceTokenBudget(
        blocks,
        50,
      );
      expect(droppedKinds[0]).toBe('rag');
      expect(out.find((b) => b.kind === 'system')).toBeDefined();
      expect(out.find((b) => b.kind === 'memory')).toBeDefined();
    });
  });
});
