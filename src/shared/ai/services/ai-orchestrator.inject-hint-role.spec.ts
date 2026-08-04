import { AiOrchestratorService } from './ai-orchestrator.service';

/**
 * Cobertura pontual da Task 12b: `injectSystemHint` aceita `role` e o hint de
 * documento pendente (que carrega texto extraído de arquivo enviado por
 * terceiro) entra como `role: 'user'`, nunca `role: 'system'` — a posição de
 * maior confiança do prompt. Os demais hints (numeric choice, pending
 * confirmation) são determinísticos, gerados pelo próprio código, e
 * continuam como `role: 'system'` por padrão.
 */
describe('AiOrchestratorService.injectSystemHint — role do hint de documento', () => {
  const service = Object.create(
    AiOrchestratorService.prototype,
  ) as AiOrchestratorService;
  // `logger` é inicializado no corpo do construtor (property initializer),
  // que Object.create não executa — stub manual necessário.
  (service as any).logger = { log: jest.fn() };

  function inject(
    messages: any[],
    hint: string,
    tag: string,
    role?: 'system' | 'user',
  ) {
    return (service as any).injectSystemHint(
      messages,
      hint,
      tag,
      'SM-test',
      'conv-1',
      role,
    );
  }

  it('usa role system por padrão (hints determinísticos)', () => {
    const messages: any[] = [{ role: 'system', content: 'prompt base' }];
    inject(messages, 'hint numerico', 'NUMERIC_CHOICE');
    expect(messages.some((m) => m.role === 'system' && m.content === 'hint numerico')).toBe(true);
  });

  it('injeta o hint de documento como role user', () => {
    const messages: any[] = [{ role: 'system', content: 'prompt base' }];
    inject(
      messages,
      '<DADOS_EXTRAIDOS_DE_DOCUMENTO>texto do laudo</DADOS_EXTRAIDOS_DE_DOCUMENTO>',
      'AI_DOC_PENDING_HINT',
      'user',
    );
    const injetado = messages.find((m) => m.content?.includes('DADOS_EXTRAIDOS_DE_DOCUMENTO'));
    expect(injetado?.role).toBe('user');
  });

  it('nunca insere o hint de documento como system', () => {
    const messages: any[] = [{ role: 'system', content: 'prompt base' }];
    inject(messages, 'conteudo de documento', 'AI_DOC_PENDING_HINT', 'user');
    const injetado = messages.find((m) => m.content === 'conteudo de documento');
    expect(injetado?.role).not.toBe('system');
  });
});
