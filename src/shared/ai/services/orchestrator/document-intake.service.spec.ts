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
    loadRecentForLlm: jest.fn().mockResolvedValue([]),
    ...overrides.conversationService,
  };
  const phoneNormalizer = {
    maskPhone: jest
      .fn()
      .mockImplementation((p: string) => p.slice(-4).padStart(p.length, '*')),
    ...overrides.phoneNormalizer,
  };
  const conversationMemory = {
    getAwaitingMedia: jest.fn().mockResolvedValue(null),
    setAwaitingMedia: jest.fn().mockResolvedValue(undefined),
    clearAwaitingMedia: jest.fn().mockResolvedValue(undefined),
    ...overrides.conversationMemory,
  };
  return {
    documentDispatcher,
    documentProcessor,
    whatsappService,
    conversationService,
    phoneNormalizer,
    conversationMemory,
  };
}

describe('DocumentIntakeService', () => {
  describe('processInboundDocumentIfNeeded', () => {
    it('retorna handled=false quando pipeline de documentos está desabilitado', async () => {
      const deps = makeDeps({
        documentDispatcher: { isEnabled: jest.fn().mockReturnValue(false) },
      });
      const svc = new DocumentIntakeService(
        deps.documentDispatcher as any,
        deps.documentProcessor as any,
        deps.whatsappService as any,
        deps.conversationService as any,
        deps.phoneNormalizer as any,
        deps.conversationMemory as any,
      );
      const result = await svc.processInboundDocumentIfNeeded({
        phone: '+5511999999999',
        body: 'olá',
        normalizedInput: 'ola',
        messageSid: 'sid',
        userId: 'user-1',
      });
      expect(result.handled).toBe(false);
    });

    it('retorna handled=false quando não há mídia nova nem pendência ativa', async () => {
      const deps = makeDeps();
      const svc = new DocumentIntakeService(
        deps.documentDispatcher as any,
        deps.documentProcessor as any,
        deps.whatsappService as any,
        deps.conversationService as any,
        deps.phoneNormalizer as any,
        deps.conversationMemory as any,
      );
      const result = await svc.processInboundDocumentIfNeeded({
        phone: '+5511999999999',
        body: 'olá',
        normalizedInput: 'ola',
        messageSid: 'sid',
        userId: 'user-1',
      });
      expect(result.handled).toBe(false);
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
        deps.conversationMemory as any,
      );
      const result = await svc.processInboundDocumentIfNeeded({
        phone: '+5511999999999',
        body: '',
        normalizedInput: '',
        messageSid: 'sid',
        userId: 'user-1',
      });
      expect(result.handled).toBe(true);
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
        deps.conversationMemory as any,
      );
      const result = await svc.processInboundDocumentIfNeeded({
        phone: '+5511999999999',
        body: 'cancelar',
        normalizedInput: 'cancelar',
        messageSid: 'sid',
        userId: 'user-1',
      });
      expect(result.handled).toBe(true);
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
        deps.conversationMemory as any,
      );
      const result = await svc.processInboundDocumentIfNeeded({
        phone: '+5511999999999',
        body: '3',
        normalizedInput: '3',
        messageSid: 'sid',
        userId: 'user-1',
        conversationId: 'conv-1',
      });
      expect(result.handled).toBe(true);
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
        deps.conversationMemory as any,
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
      expect(result.handled).toBe(true);
    });

    describe('bypass de assinatura', () => {
      it('bypassa pipeline quando caption menciona "assinatura"', async () => {
        const deps = makeDeps({
          documentDispatcher: {
            isEnabled: jest.fn().mockReturnValue(true),
            pickDocumentMedia: jest.fn().mockReturnValue({
              url: 'http://img',
              contentType: 'image/jpeg',
              category: 'image',
            }),
            getPending: jest.fn().mockResolvedValue(null),
          },
        });
        const svc = new DocumentIntakeService(
          deps.documentDispatcher as any,
          deps.documentProcessor as any,
          deps.whatsappService as any,
          deps.conversationService as any,
          deps.phoneNormalizer as any,
          deps.conversationMemory as any,
        );
        const result = await svc.processInboundDocumentIfNeeded({
          phone: '+5511999999999',
          body: 'Essa é minha assinatura',
          normalizedInput: 'essa e minha assinatura',
          messageSid: 'sid',
          userId: 'user-1',
          conversationId: 'conv-1',
        });
        expect(result.handled).toBe(false);
        // Sem caption, não deve precisar de syntheticBody
        expect(result.syntheticBody).toBeUndefined();
        // Pipeline de staging não deve ter sido chamado
        expect(
          deps.documentDispatcher.stageInboundDocument,
        ).not.toHaveBeenCalled();
      });

      it('bypassa pipeline e injeta syntheticBody quando imagem chega sem caption mas histórico menciona assinatura', async () => {
        const deps = makeDeps({
          documentDispatcher: {
            isEnabled: jest.fn().mockReturnValue(true),
            pickDocumentMedia: jest.fn().mockReturnValue({
              url: 'http://img',
              contentType: 'image/jpeg',
              category: 'image',
            }),
            getPending: jest.fn().mockResolvedValue(null),
          },
          conversationService: {
            appendMessage: jest.fn().mockResolvedValue(undefined),
            loadRecentForLlm: jest.fn().mockResolvedValue([
              { role: 'user', content: 'Vou te mandar minha assinatura agora' },
              {
                role: 'assistant',
                content: 'Pode enviar! Assim que receber faço o upload.',
              },
            ]),
          },
        });
        const svc = new DocumentIntakeService(
          deps.documentDispatcher as any,
          deps.documentProcessor as any,
          deps.whatsappService as any,
          deps.conversationService as any,
          deps.phoneNormalizer as any,
          deps.conversationMemory as any,
        );
        const result = await svc.processInboundDocumentIfNeeded({
          phone: '+5511999999999',
          body: '', // sem caption
          normalizedInput: '',
          messageSid: 'sid',
          userId: 'user-1',
          conversationId: 'conv-1',
        });
        expect(result.handled).toBe(false);
        expect(result.syntheticBody).toBe(
          'Quero fazer upload da minha assinatura digital.',
        );
        expect(
          deps.documentDispatcher.stageInboundDocument,
        ).not.toHaveBeenCalled();
      });

      // Regressão 2026-05-14: Carlos perguntou "pendências da SC pendente",
      // assistente respondeu "envie a foto da sua assinatura". Carlos
      // mandou a foto sem caption. Como o histórico do USUÁRIO não tinha
      // "assinatura" (só do assistente), o pipeline genérico engajava e
      // mostrava "1=anexar SC / 2=criar SC / 3=cadastrar paciente",
      // confundindo. Agora o último turno do assistente também conta.
      it('bypassa quando última msg do assistente pediu a assinatura e foto chega sem caption', async () => {
        const deps = makeDeps({
          documentDispatcher: {
            isEnabled: jest.fn().mockReturnValue(true),
            pickDocumentMedia: jest.fn().mockReturnValue({
              url: 'http://img',
              contentType: 'image/jpeg',
              category: 'image',
            }),
            getPending: jest.fn().mockResolvedValue(null),
          },
          conversationService: {
            appendMessage: jest.fn().mockResolvedValue(undefined),
            loadRecentForLlm: jest.fn().mockResolvedValue([
              { role: 'user', content: 'Pendências da SC pendente' },
              {
                role: 'assistant',
                content:
                  'Falta apenas a assinatura digital do médico. Envie a foto da sua assinatura aqui no WhatsApp para eu registrar.',
              },
            ]),
          },
        });
        const svc = new DocumentIntakeService(
          deps.documentDispatcher as any,
          deps.documentProcessor as any,
          deps.whatsappService as any,
          deps.conversationService as any,
          deps.phoneNormalizer as any,
          deps.conversationMemory as any,
        );
        const result = await svc.processInboundDocumentIfNeeded({
          phone: '+5511999999999',
          body: '', // sem caption
          normalizedInput: '',
          messageSid: 'sid',
          userId: 'user-1',
          conversationId: 'conv-1',
        });
        expect(result.handled).toBe(false);
        expect(result.syntheticBody).toBe(
          'Quero fazer upload da minha assinatura digital.',
        );
        expect(
          deps.documentDispatcher.stageInboundDocument,
        ).not.toHaveBeenCalled();
      });

      it('NÃO bypassa pipeline quando caption menciona outro tipo de documento', async () => {
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
            buildIntentPromptMessage: jest.fn().mockReturnValue('1/2/3'),
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
          deps.conversationMemory as any,
        );
        const result = await svc.processInboundDocumentIfNeeded({
          phone: '+5511999999999',
          body: 'Aqui meu RG',
          normalizedInput: 'aqui meu rg',
          messageSid: 'sid',
          userId: 'user-1',
          conversationId: 'conv-1',
        });
        // RG deve ir pelo pipeline normal
        expect(result.handled).toBe(true);
        expect(deps.documentDispatcher.stageInboundDocument).toHaveBeenCalled();
      });

      it('NÃO bypassa pipeline quando mídia é PDF (PDFs nunca são assinatura)', async () => {
        const deps = makeDeps({
          documentDispatcher: {
            isEnabled: jest.fn().mockReturnValue(true),
            pickDocumentMedia: jest.fn().mockReturnValue({
              url: 'http://doc.pdf',
              contentType: 'application/pdf',
              category: 'pdf',
            }),
            getPending: jest.fn().mockResolvedValue(null),
            stageInboundDocument: jest
              .fn()
              .mockResolvedValue({ status: 'staged' }),
            buildIntentPromptMessage: jest.fn().mockReturnValue('1/2/3'),
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
          deps.conversationMemory as any,
        );
        const result = await svc.processInboundDocumentIfNeeded({
          phone: '+5511999999999',
          body: 'minha assinatura',
          normalizedInput: 'minha assinatura',
          messageSid: 'sid',
          userId: 'user-1',
          conversationId: 'conv-1',
        });
        // PDF deve sempre ir pelo pipeline, mesmo que caption mencione assinatura
        expect(result.handled).toBe(true);
        expect(deps.documentDispatcher.stageInboundDocument).toHaveBeenCalled();
      });
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
        deps.conversationMemory as any,
      );
      const msg = svc.buildDocumentReminderMessage('attach', {
        classification: { kind: 'laudo' },
      });
      expect(msg).toContain('laudo');
      expect(msg).toContain('protocolo');
    });
  });
});
