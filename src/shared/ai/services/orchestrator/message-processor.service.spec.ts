import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  MessageProcessorService,
  PreflightHooks,
} from './message-processor.service';
import { PhoneNormalizerService } from './phone-normalizer.service';
import { ResponseNormalizerService } from './response-normalizer.service';

const buildHooks = (
  overrides: Partial<PreflightHooks> = {},
): PreflightHooks => ({
  redactResidualPii: jest.fn().mockResolvedValue(undefined),
  getRemainingTimeoutMs: jest.fn().mockReturnValue(20000),
  ...overrides,
});

describe('MessageProcessorService', () => {
  let service: MessageProcessorService;
  let aiQueue: { add: jest.Mock };
  let configService: { get: jest.Mock };
  let aiRedis: { isAvailable: boolean; checkRateLimit: jest.Mock };
  let whatsappService: { sendMessage: jest.Mock };
  let openaiService: { chatCompletion: jest.Mock };
  let ragService: { search: jest.Mock; formatContext: jest.Mock };
  let piiVault: {
    startSession: jest.Mock;
    endSession: jest.Mock;
    preprocessUserInput: jest.Mock;
  };
  let userRepository: { findOneByPhone: jest.Mock };
  let phoneNormalizer: PhoneNormalizerService;
  let responseNormalizer: ResponseNormalizerService;

  beforeEach(() => {
    aiQueue = { add: jest.fn().mockResolvedValue(undefined) };
    configService = { get: jest.fn().mockReturnValue(undefined) };
    aiRedis = { isAvailable: false, checkRateLimit: jest.fn() };
    whatsappService = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    openaiService = { chatCompletion: jest.fn() };
    ragService = {
      search: jest.fn(),
      formatContext: jest.fn().mockResolvedValue('contexto'),
    };
    piiVault = {
      startSession: jest.fn(),
      endSession: jest.fn(),
      preprocessUserInput: jest.fn((_id, t) => t),
    };
    userRepository = { findOneByPhone: jest.fn() };
    phoneNormalizer = new PhoneNormalizerService(userRepository as any);
    responseNormalizer = new ResponseNormalizerService();

    service = new MessageProcessorService(
      aiQueue as any,
      configService as unknown as ConfigService,
      aiRedis as any,
      whatsappService as any,
      openaiService as any,
      ragService as any,
      piiVault as any,
      phoneNormalizer,
      responseNormalizer,
    );
  });

  describe('enqueueInboundMessage', () => {
    it('queues the message with retry policy', async () => {
      const data = {
        from: 'whatsapp:+5511999999999',
        body: 'oi',
        messageSid: 'sid-1',
        mediaUrl: null,
      };
      await service.enqueueInboundMessage(data);
      expect(aiQueue.add).toHaveBeenCalledWith(
        'process-message',
        expect.objectContaining({
          from: data.from,
          body: data.body,
          messageSid: data.messageSid,
          mediaUrl: data.mediaUrl,
          _otelCarrier: expect.any(Object),
        }),
        expect.objectContaining({
          attempts: 2,
          backoff: { type: 'exponential', delay: 3000 },
          removeOnComplete: true,
        }),
      );
    });
  });

  describe('runPreflight — rate limit', () => {
    it('returns rate_limited and warns user when limit exceeded', async () => {
      configService.get.mockImplementation((k, def) => {
        if (k === 'AI_RATELIMIT_MAX') return 1;
        if (k === 'AI_RATELIMIT_WINDOW_SEC') return 60;
        return def;
      });
      userRepository.findOneByPhone.mockResolvedValue({
        id: 'user-1',
        aiConsentAcceptedAt: new Date(),
      });

      const input = {
        phone: '+5511999999999',
        lookupCandidates: ['+5511999999999'],
        body: 'a',
        messageSid: 'sid-1',
        processStartedAt: Date.now(),
        processTimeoutMs: 60000,
      };

      const first = await service.runPreflight(input, buildHooks());
      expect(first.status).toBe('continue');

      const second = await service.runPreflight(input, buildHooks());
      expect(second.status).toBe('rate_limited');
      expect(whatsappService.sendMessage).toHaveBeenCalledWith(
        '+5511999999999',
        expect.stringContaining('ritmo muito alto'),
      );
    });

    it('uses Redis when available', async () => {
      aiRedis.isAvailable = true;
      aiRedis.checkRateLimit.mockResolvedValue(false);

      const result = await service.runPreflight(
        {
          phone: '+5511',
          lookupCandidates: [],
          body: 'a',
          messageSid: 'sid',
          processStartedAt: Date.now(),
          processTimeoutMs: 60000,
        },
        buildHooks(),
      );

      expect(aiRedis.checkRateLimit).toHaveBeenCalled();
      expect(result.status).toBe('rate_limited');
    });
  });

  describe('runPreflight — unknown user', () => {
    it('returns unknown_user and triggers handleUnknownUser', async () => {
      userRepository.findOneByPhone.mockResolvedValue(null);
      openaiService.chatCompletion.mockResolvedValue({
        choices: [{ message: { content: 'cadastre-se' } }],
      });

      const result = await service.runPreflight(
        {
          phone: '+5511999999999',
          lookupCandidates: ['+5511999999999'],
          body: 'oi',
          messageSid: 'sid',
          processStartedAt: Date.now(),
          processTimeoutMs: 60000,
        },
        buildHooks(),
      );

      expect(result.status).toBe('unknown_user');
      expect(openaiService.chatCompletion).toHaveBeenCalled();
      expect(whatsappService.sendMessage).toHaveBeenCalledWith(
        '+5511999999999',
        expect.stringContaining('cadastre-se'),
      );
    });
  });

  describe('runPreflight — consent gate', () => {
    const userWithoutConsent = {
      id: 'user-1',
      aiConsentAcceptedAt: null,
    } as any;
    const userWithConsent = {
      id: 'user-1',
      aiConsentAcceptedAt: new Date('2026-01-01'),
    } as any;

    it('returns consent_block(notice) when no consent and FAQ skipped (PII)', async () => {
      userRepository.findOneByPhone.mockResolvedValue(userWithoutConsent);
      piiVault.preprocessUserInput.mockReturnValue('texto com {{cpf_1}}');

      const result = await service.runPreflight(
        {
          phone: '+5511999999999',
          lookupCandidates: ['+5511999999999'],
          body: 'meu cpf é 12345678900 quero saber',
          messageSid: 'sid',
          processStartedAt: Date.now(),
          processTimeoutMs: 60000,
        },
        buildHooks(),
      );

      expect(result.status).toBe('consent_block');
      expect((result as any).mode).toBe('notice');
      expect(whatsappService.sendMessage).toHaveBeenCalledWith(
        '+5511999999999',
        expect.stringContaining('Inexci'),
      );
    });

    it('returns consent_block(suppressed) when notice already sent within cooldown', async () => {
      userRepository.findOneByPhone.mockResolvedValue(userWithoutConsent);
      piiVault.preprocessUserInput.mockReturnValue('texto sem pii');
      ragService.search.mockResolvedValue([]);

      const phone = '+5511999999999';
      service.markAiConsentNoticeSent(phone);

      const result = await service.runPreflight(
        {
          phone,
          lookupCandidates: [phone],
          body: 'pergunta sem hits no rag',
          messageSid: 'sid',
          processStartedAt: Date.now(),
          processTimeoutMs: 60000,
        },
        buildHooks(),
      );

      expect(result.status).toBe('consent_block');
      expect((result as any).mode).toBe('suppressed');
    });

    it('returns consent_block(limited_faq) when FAQ answers the question', async () => {
      userRepository.findOneByPhone.mockResolvedValue(userWithoutConsent);
      piiVault.preprocessUserInput.mockReturnValue('como ativar IA?');
      ragService.search.mockResolvedValue([{ id: 'r1' }]);
      openaiService.chatCompletion.mockResolvedValue({
        choices: [{ message: { content: 'ative na plataforma web' } }],
      });

      const result = await service.runPreflight(
        {
          phone: '+5511999999999',
          lookupCandidates: ['+5511999999999'],
          body: 'como ativo o assistente?',
          messageSid: 'sid',
          processStartedAt: Date.now(),
          processTimeoutMs: 60000,
        },
        buildHooks(),
      );

      expect(result.status).toBe('consent_block');
      expect((result as any).mode).toBe('limited_faq');
      expect(whatsappService.sendMessage).toHaveBeenCalledWith(
        '+5511999999999',
        expect.stringContaining('ative'),
      );
    });

    it('returns continue when consent valid', async () => {
      userRepository.findOneByPhone.mockResolvedValue(userWithConsent);

      const result = await service.runPreflight(
        {
          phone: '+5511999999999',
          lookupCandidates: ['+5511999999999'],
          body: 'oi',
          messageSid: 'sid',
          processStartedAt: Date.now(),
          processTimeoutMs: 60000,
        },
        buildHooks(),
      );

      expect(result.status).toBe('continue');
      expect((result as any).user).toBe(userWithConsent);
      expect((result as any).userId).toBe('user-1');
    });
  });

  describe('hasValidAiConsent', () => {
    it('returns true when aiConsentAcceptedAt is set', () => {
      expect(
        service.hasValidAiConsent({ aiConsentAcceptedAt: new Date() } as any),
      ).toBe(true);
    });
    it('returns false otherwise', () => {
      expect(service.hasValidAiConsent(null)).toBe(false);
      expect(
        service.hasValidAiConsent({ aiConsentAcceptedAt: null } as any),
      ).toBe(false);
    });
  });

  describe('hasRecentlyNoticedAiConsent / markAiConsentNoticeSent', () => {
    it('returns true after marking and false after cooldown', () => {
      const phone = '+55';
      expect(service.hasRecentlyNoticedAiConsent(phone)).toBe(false);
      service.markAiConsentNoticeSent(phone);
      expect(service.hasRecentlyNoticedAiConsent(phone)).toBe(true);
    });
  });

  describe('inputContainsPii', () => {
    it('detects placeholders', () => {
      expect(service.inputContainsPii('cpf 123', 'cpf {{cpf_1}}')).toBe(true);
    });
    it('returns false when texts are equal', () => {
      expect(service.inputContainsPii('foo', 'foo')).toBe(false);
    });
    it('returns false when processed is empty', () => {
      expect(service.inputContainsPii('foo', '')).toBe(false);
    });
  });

  describe('buildAiConsentMissingMessage', () => {
    it('uses default portal URL when env not set', () => {
      const msg = service.buildAiConsentMissingMessage();
      expect(msg).toContain('https://app.inexci.com/configuracoes/privacidade');
    });
    it('uses configured portal URL', () => {
      configService.get.mockImplementation((k) =>
        k === 'AI_CONSENT_PORTAL_URL' ? 'https://custom.example' : undefined,
      );
      const msg = service.buildAiConsentMissingMessage();
      expect(msg).toContain('https://custom.example');
    });
  });

  describe('tryAnswerLimitedFaq', () => {
    it('returns false for empty input', async () => {
      expect(
        await service.tryAnswerLimitedFaq('+55', '', 'sid', buildHooks()),
      ).toBe(false);
    });

    it('returns false for short input (< 8 chars)', async () => {
      expect(
        await service.tryAnswerLimitedFaq('+55', 'oi', 'sid', buildHooks()),
      ).toBe(false);
    });

    it('returns false when PII detected', async () => {
      piiVault.preprocessUserInput.mockReturnValue('contains {{cpf_1}}');
      expect(
        await service.tryAnswerLimitedFaq(
          '+55',
          'meu cpf é 12345678901',
          'sid',
          buildHooks(),
        ),
      ).toBe(false);
    });

    it('returns false when RAG has no hits', async () => {
      piiVault.preprocessUserInput.mockReturnValue('como funciona?');
      ragService.search.mockResolvedValue([]);
      expect(
        await service.tryAnswerLimitedFaq(
          '+55',
          'como funciona o sistema?',
          'sid',
          buildHooks(),
        ),
      ).toBe(false);
    });

    it('returns false when RAG search throws', async () => {
      piiVault.preprocessUserInput.mockReturnValue('como funciona?');
      ragService.search.mockRejectedValue(new Error('rag down'));
      expect(
        await service.tryAnswerLimitedFaq(
          '+55',
          'como funciona o sistema?',
          'sid',
          buildHooks(),
        ),
      ).toBe(false);
    });

    it('returns false when completion is empty', async () => {
      piiVault.preprocessUserInput.mockReturnValue('como funciona?');
      ragService.search.mockResolvedValue([{ id: 'r1' }]);
      openaiService.chatCompletion.mockResolvedValue({
        choices: [{ message: { content: '' } }],
      });
      expect(
        await service.tryAnswerLimitedFaq(
          '+55',
          'como funciona o sistema?',
          'sid',
          buildHooks(),
        ),
      ).toBe(false);
    });

    it('returns true and sends WhatsApp message on success', async () => {
      piiVault.preprocessUserInput.mockReturnValue('como funciona?');
      ragService.search.mockResolvedValue([{ id: 'r1' }]);
      openaiService.chatCompletion.mockResolvedValue({
        choices: [{ message: { content: 'resposta' } }],
      });

      const hooks = buildHooks();
      const result = await service.tryAnswerLimitedFaq(
        '+5511',
        'como funciona o sistema?',
        'sid',
        hooks,
      );
      expect(result).toBe(true);
      expect(hooks.redactResidualPii).toHaveBeenCalled();
      expect(whatsappService.sendMessage).toHaveBeenCalledWith(
        '+5511',
        'resposta',
      );
      expect(piiVault.endSession).toHaveBeenCalledWith('faq:+5511');
    });
  });

  describe('handleUnknownUser', () => {
    it('sends normalized message based on completion', async () => {
      openaiService.chatCompletion.mockResolvedValue({
        choices: [{ message: { content: '*Bem-vindo!*' } }],
      });
      await service.handleUnknownUser('+55', 'oi');
      expect(whatsappService.sendMessage).toHaveBeenCalledWith(
        '+55',
        expect.any(String),
      );
      const sent = whatsappService.sendMessage.mock.calls[0][1];
      expect(sent).not.toContain('*Bem-vindo!*');
    });

    it('uses fallback content when completion has no content', async () => {
      openaiService.chatCompletion.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });
      await service.handleUnknownUser('+55', 'oi');
      expect(whatsappService.sendMessage.mock.calls[0][1]).toContain('Inexci');
    });

    it('passes timeout when hooks.getRemainingTimeoutMs provided', async () => {
      openaiService.chatCompletion.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
      });
      const hooks = buildHooks({
        getRemainingTimeoutMs: jest.fn().mockReturnValue(7777),
      });
      await service.handleUnknownUser('+55', 'oi', 1000, 5000, hooks);
      expect(openaiService.chatCompletion).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: 7777 }),
      );
    });
  });

  describe('tryAnswerLimitedFaq — sintaxe de options no ragService.search', () => {
    it('chama ragService.search com a sintaxe { topK, minScore } e não com parâmetros posicionais', async () => {
      piiVault.preprocessUserInput.mockReturnValue(
        'como criar uma solicitação cirúrgica?',
      );
      ragService.search.mockResolvedValue([{ id: 'r1', content: 'c1' }]);
      ragService.formatContext.mockResolvedValue('contexto mock');
      openaiService.chatCompletion.mockResolvedValue({
        choices: [{ message: { content: 'Para criar, acesse o menu.' } }],
      });

      const hooks = buildHooks();
      const result = await service.tryAnswerLimitedFaq(
        '+5511999999999',
        'como criar uma solicitação cirúrgica?',
        'sid-opts-test',
        hooks,
      );

      expect(result).toBe(true);
      expect(ragService.search).toHaveBeenCalledWith(expect.any(String), {
        topK: 3,
        minScore: 0.7,
      });

      // Garante que NÃO foi chamado com a sobrecarga posicional legacy (3 args)
      const call = ragService.search.mock.calls[0];
      expect(call).toHaveLength(2);
      expect(typeof call[1]).toBe('object');
    });
  });

  describe('invalidateUserCacheByPhone', () => {
    it('clears user cache for normalized variants', async () => {
      const userWithConsent = {
        id: 'user-1',
        aiConsentAcceptedAt: new Date(),
      } as any;
      userRepository.findOneByPhone
        .mockResolvedValueOnce(userWithConsent)
        .mockResolvedValueOnce(null);

      const input = {
        phone: '+5511999999999',
        lookupCandidates: ['+5511999999999'],
        body: 'oi',
        messageSid: 'sid',
        processStartedAt: Date.now(),
        processTimeoutMs: 60000,
      };

      const a = await service.runPreflight(input, buildHooks());
      expect(a.status).toBe('continue');

      service.invalidateUserCacheByPhone('whatsapp:+5511999999999');

      // After invalidation, lookup is called again (returning null this time)
      // hence subsequent flow goes to unknown_user.
      openaiService.chatCompletion.mockResolvedValue({
        choices: [{ message: { content: 'cadastre-se' } }],
      });
      const b = await service.runPreflight(input, buildHooks());
      expect(b.status).toBe('unknown_user');
    });

    it('returns early when phone is null/undefined', () => {
      expect(() => service.invalidateUserCacheByPhone(null)).not.toThrow();
      expect(() => service.invalidateUserCacheByPhone(undefined)).not.toThrow();
    });
  });
});
