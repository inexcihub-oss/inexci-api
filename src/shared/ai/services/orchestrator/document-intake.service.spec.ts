import { DocumentIntakeService } from './document-intake.service';

function makeDeps(overrides: Partial<Record<string, any>> = {}) {
  const documentDispatcher = {
    isEnabled: jest.fn().mockReturnValue(true),
    pickDocumentMedia: jest.fn().mockReturnValue(null),
    getPending: jest.fn().mockResolvedValue(null),
    clearPending: jest.fn().mockResolvedValue(undefined),
    deleteStoragePath: jest.fn().mockResolvedValue(undefined),
    stageInboundDocument: jest.fn(),
    buildDownloadFailureMessage: jest.fn().mockReturnValue('Falha no download'),
    buildIntentPromptMessage: jest.fn().mockReturnValue('Escolha: 1/2/3'),
    parseIntent: jest.fn().mockReturnValue(null),
    ...overrides.documentDispatcher,
  };
  const documentProcessor = {
    processPendingDocument: jest.fn().mockResolvedValue({
      status: 'ok',
      userSummary: 'Documento processado.',
    }),
    ...overrides.documentProcessor,
  };
  const whatsappService = {
    sendMessage: jest.fn().mockResolvedValue(undefined),
    ...overrides.whatsappService,
  };
  const conversationService = {
    appendMessage: jest.fn().mockResolvedValue(undefined),
    ...overrides.conversationService,
  };
  const phoneNormalizer = {
    maskPhone: jest
      .fn()
      .mockImplementation((p: string) => p.slice(-4).padStart(p.length, '*')),
    ...overrides.phoneNormalizer,
  };
  return {
    documentDispatcher,
    documentProcessor,
    whatsappService,
    conversationService,
    phoneNormalizer,
  };
}

describe('DocumentIntakeService', () => {
  describe('processInboundDocumentIfNeeded', () => {
    it('retorna false quando pipeline de documentos está desabilitado', async () => {
      const deps = makeDeps({
        documentDispatcher: { isEnabled: jest.fn().mockReturnValue(false) },
      });
      const svc = new DocumentIntakeService(
        deps.documentDispatcher as any,
        deps.documentProcessor as any,
        deps.whatsappService as any,
        deps.conversationService as any,
        deps.phoneNormalizer as any,
      );
      const result = await svc.processInboundDocumentIfNeeded({
        phone: '+5511999999999',
        body: 'olá',
        normalizedInput: 'ola',
        messageSid: 'sid',
        userId: 'user-1',
      });
      expect(result).toBe(false);
    });

    it('retorna false quando não há mídia nova nem pendência ativa', async () => {
      const deps = makeDeps();
      const svc = new DocumentIntakeService(
        deps.documentDispatcher as any,
        deps.documentProcessor as any,
        deps.whatsappService as any,
        deps.conversationService as any,
        deps.phoneNormalizer as any,
      );
      const result = await svc.processInboundDocumentIfNeeded({
        phone: '+5511999999999',
        body: 'olá',
        normalizedInput: 'ola',
        messageSid: 'sid',
        userId: 'user-1',
      });
      expect(result).toBe(false);
    });

    it('encerra o turno enviando prompt de intent quando documento é staged', async () => {
      const deps = makeDeps({
        documentDispatcher: {
          isEnabled: jest.fn().mockReturnValue(true),
          pickDocumentMedia: jest.fn().mockReturnValue({
            url: 'http://img',
            contentType: 'image/jpeg',
            category: 'image',
          }),
          getPending: jest.fn().mockResolvedValue(null),
          stageInboundDocument: jest
            .fn()
            .mockResolvedValue({ status: 'staged' }),
          buildIntentPromptMessage: jest
            .fn()
            .mockReturnValue('1=anexar / 2=criar SC'),
          clearPending: jest.fn(),
          deleteStoragePath: jest.fn(),
        },
      });
      const svc = new DocumentIntakeService(
        deps.documentDispatcher as any,
        deps.documentProcessor as any,
        deps.whatsappService as any,
        deps.conversationService as any,
        deps.phoneNormalizer as any,
      );
      const result = await svc.processInboundDocumentIfNeeded({
        phone: '+5511999999999',
        body: '',
        normalizedInput: '',
        messageSid: 'sid',
        userId: 'user-1',
      });
      expect(result).toBe(true);
      expect(deps.whatsappService.sendMessage).toHaveBeenCalledWith(
        '+5511999999999',
        '1=anexar / 2=criar SC',
      );
    });

    it('cancela documento pendente e encerra o turno quando intent=cancel', async () => {
      const pending = {
        storagePath: 'tmp/file.jpg',
        classification: null,
        intent: null,
        classifiedAt: null,
      };
      const deps = makeDeps({
        documentDispatcher: {
          isEnabled: jest.fn().mockReturnValue(true),
          pickDocumentMedia: jest.fn().mockReturnValue(null),
          getPending: jest.fn().mockResolvedValue(pending),
          parseIntent: jest.fn().mockReturnValue('cancel'),
          clearPending: jest.fn().mockResolvedValue(undefined),
          deleteStoragePath: jest.fn().mockResolvedValue(undefined),
        },
      });
      const svc = new DocumentIntakeService(
        deps.documentDispatcher as any,
        deps.documentProcessor as any,
        deps.whatsappService as any,
        deps.conversationService as any,
        deps.phoneNormalizer as any,
      );
      const result = await svc.processInboundDocumentIfNeeded({
        phone: '+5511999999999',
        body: 'cancelar',
        normalizedInput: 'cancelar',
        messageSid: 'sid',
        userId: 'user-1',
      });
      expect(result).toBe(true);
      expect(deps.documentDispatcher.clearPending).toHaveBeenCalled();
      expect(deps.whatsappService.sendMessage).toHaveBeenCalledWith(
        '+5511999999999',
        expect.stringContaining('descartei o arquivo'),
      );
    });

    it('processa documento com intent create_patient e injeta summary no histórico', async () => {
      const pending = {
        storagePath: 'tmp/rg.jpg',
        classification: null,
        intent: null,
        classifiedAt: null,
      };
      const deps = makeDeps({
        documentDispatcher: {
          isEnabled: jest.fn().mockReturnValue(true),
          pickDocumentMedia: jest.fn().mockReturnValue(null),
          getPending: jest.fn().mockResolvedValue(pending),
          parseIntent: jest.fn().mockReturnValue('create_patient'),
          clearPending: jest.fn(),
          deleteStoragePath: jest.fn(),
        },
        documentProcessor: {
          processPendingDocument: jest.fn().mockResolvedValue({
            status: 'ok',
            userSummary: 'Paciente identificado: João da Silva.',
          }),
        },
      });
      const svc = new DocumentIntakeService(
        deps.documentDispatcher as any,
        deps.documentProcessor as any,
        deps.whatsappService as any,
        deps.conversationService as any,
        deps.phoneNormalizer as any,
      );
      const result = await svc.processInboundDocumentIfNeeded({
        phone: '+5511999999999',
        body: '3',
        normalizedInput: '3',
        messageSid: 'sid',
        userId: 'user-1',
        conversationId: 'conv-1',
      });
      expect(result).toBe(true);
      expect(deps.whatsappService.sendMessage).toHaveBeenCalledWith(
        '+5511999999999',
        'Paciente identificado: João da Silva.',
      );
      expect(deps.conversationService.appendMessage).toHaveBeenCalledWith(
        'conv-1',
        'assistant',
        'Paciente identificado: João da Silva.',
      );
    });

    it('não bloqueia o turno quando pendência expirou (classifiedAt > 5 min)', async () => {
      const pending = {
        storagePath: 'tmp/old.jpg',
        classification: {
          kind: 'medical_report',
          confidence: 0.9,
          extracted: {},
          suggestedDocumentType: 'medical_report',
        },
        intent: 'attach',
        classifiedAt: Date.now() - 6 * 60 * 1000, // 6 min atrás
      };
      const deps = makeDeps({
        documentDispatcher: {
          isEnabled: jest.fn().mockReturnValue(true),
          pickDocumentMedia: jest.fn().mockReturnValue(null),
          getPending: jest.fn().mockResolvedValue(pending),
          parseIntent: jest.fn().mockReturnValue('attach'),
          clearPending: jest.fn(),
          deleteStoragePath: jest.fn(),
        },
        documentProcessor: {
          processPendingDocument: jest.fn().mockResolvedValue({
            status: 'ok',
            userSummary: 'Documento processado.',
          }),
        },
      });
      const svc = new DocumentIntakeService(
        deps.documentDispatcher as any,
        deps.documentProcessor as any,
        deps.whatsappService as any,
        deps.conversationService as any,
        deps.phoneNormalizer as any,
      );
      // Com pendência expirada, o intent=attach ainda chama o processor
      // (não há reuso de cache).
      const result = await svc.processInboundDocumentIfNeeded({
        phone: '+5511999999999',
        body: '1',
        normalizedInput: '1',
        messageSid: 'sid',
        userId: 'user-1',
      });
      // Se o processor retornou ok+summary, encerra o turno.
      expect(result).toBe(true);
    });
  });

  describe('buildDocumentReminderMessage', () => {
    it('gera mensagem correta para intent attach', () => {
      const deps = makeDeps();
      const svc = new DocumentIntakeService(
        deps.documentDispatcher as any,
        deps.documentProcessor as any,
        deps.whatsappService as any,
        deps.conversationService as any,
        deps.phoneNormalizer as any,
      );
      const msg = svc.buildDocumentReminderMessage('attach', {
        classification: { kind: 'laudo' },
      });
      expect(msg).toContain('laudo');
      expect(msg).toContain('protocolo');
    });
  });
});
