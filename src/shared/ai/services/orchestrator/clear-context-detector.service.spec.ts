import {
  CLEAR_CONTEXT_CONFIRMATION_TTL_MS,
  ClearContextDetectorService,
} from './clear-context-detector.service';

describe('ClearContextDetectorService', () => {
  let service: ClearContextDetectorService;

  beforeEach(() => {
    service = new ClearContextDetectorService();
  });

  describe('isClearContextCommand', () => {
    it.each([
      'limpar contexto',
      'limpar conversa',
      'limpar historico',
      'limpar histórico',
      'apagar contexto',
      'resetar conversa',
      'nova conversa',
      'sair do chat',
    ])('detecta comando exato %s', (cmd) => {
      expect(service.isClearContextCommand(cmd)).toBe(true);
    });

    it.each([
      'limpar contexto da conversa',
      'limpar conversa por favor',
      'apagar historico antigo',
    ])('aceita variantes startsWith (%s)', (cmd) => {
      expect(service.isClearContextCommand(cmd)).toBe(true);
    });

    it('rejeita comandos não relacionados', () => {
      expect(service.isClearContextCommand('quero criar uma sc')).toBe(false);
      expect(service.isClearContextCommand('sim')).toBe(false);
      expect(service.isClearContextCommand('')).toBe(false);
    });
  });

  describe('isConfirmationInput / isCancelConfirmationInput', () => {
    it('reconhece confirmações afirmativas', () => {
      expect(service.isConfirmationInput('sim')).toBe(true);
      expect(service.isConfirmationInput('confirmo')).toBe(true);
      expect(service.isConfirmationInput('confirmar')).toBe(true);
      expect(service.isConfirmationInput('pode limpar')).toBe(true);
    });

    it('reconhece cancelamentos', () => {
      expect(service.isCancelConfirmationInput('nao')).toBe(true);
      expect(service.isCancelConfirmationInput('não')).toBe(true);
      expect(service.isCancelConfirmationInput('cancelar')).toBe(true);
      expect(service.isCancelConfirmationInput('deixa assim')).toBe(true);
    });

    it('rejeita inputs ambíguos', () => {
      expect(service.isConfirmationInput('talvez')).toBe(false);
      expect(service.isCancelConfirmationInput('agora não')).toBe(false);
    });
  });

  describe('tryHandleClearContext', () => {
    it('retorna prompt e registra pending quando o comando é detectado', () => {
      const out = service.tryHandleClearContext(
        '+5511999998888',
        'limpar contexto',
        'conv-1',
      );
      expect(out.status).toBe('prompt');
      expect(out).toHaveProperty('message');
      // Confirmação subsequente deve achar pending registrada.
      const next = service.tryHandleClearContextConfirmation(
        '+5511999998888',
        'sim',
      );
      expect(next.status).toBe('confirmed');
    });

    it('retorna none quando o input não é comando de limpeza', () => {
      const out = service.tryHandleClearContext(
        '+5511999998888',
        'sim',
        'conv-1',
      );
      expect(out).toEqual({ status: 'none' });
    });
  });

  describe('tryHandleClearContextConfirmation', () => {
    const phone = '+5511999998888';

    it('retorna confirmed + conversationId quando há pending e usuário confirma', () => {
      service.tryHandleClearContext(phone, 'limpar contexto', 'conv-42');
      const out = service.tryHandleClearContextConfirmation(phone, 'sim');
      expect(out.status).toBe('confirmed');
      if (out.status === 'confirmed') {
        expect(out.conversationId).toBe('conv-42');
        expect(out.message).toContain('Limpei o contexto');
      }
      // Pending consumida — segunda chamada devolve none.
      expect(
        service.tryHandleClearContextConfirmation(phone, 'sim').status,
      ).toBe('none');
    });

    it('retorna cancelled quando o usuário responde não', () => {
      service.tryHandleClearContext(phone, 'limpar contexto', 'conv-42');
      const out = service.tryHandleClearContextConfirmation(phone, 'nao');
      expect(out.status).toBe('cancelled');
      expect(
        service.tryHandleClearContextConfirmation(phone, 'sim').status,
      ).toBe('none');
    });

    it('retorna reprompt para input ambíguo enquanto a pending estiver fresca', () => {
      service.tryHandleClearContext(phone, 'limpar contexto', 'conv-42');
      const out = service.tryHandleClearContextConfirmation(
        phone,
        'me ajude com outra coisa',
      );
      expect(out.status).toBe('reprompt');
      // Pending continua de pé.
      expect(
        service.tryHandleClearContextConfirmation(phone, 'sim').status,
      ).toBe('confirmed');
    });

    it('expira a pending após CLEAR_CONTEXT_CONFIRMATION_TTL_MS', () => {
      const realNow = Date.now;
      let now = 1_000_000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      try {
        service.tryHandleClearContext(phone, 'limpar contexto', 'conv-99');
        now += CLEAR_CONTEXT_CONFIRMATION_TTL_MS + 1000;
        const out = service.tryHandleClearContextConfirmation(phone, 'sim');
        expect(out).toEqual({ status: 'none' });
      } finally {
        Date.now = realNow;
      }
    });

    it('retorna none quando não há pending para o telefone', () => {
      const out = service.tryHandleClearContextConfirmation(phone, 'sim');
      expect(out).toEqual({ status: 'none' });
    });
  });
});
