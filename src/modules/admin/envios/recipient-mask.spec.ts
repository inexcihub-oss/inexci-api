import { maskRecipient, sanitizeDeliveryError } from './recipient-mask';

describe('maskRecipient', () => {
  it('mascara e-mail mantendo a primeira letra e o domínio', () => {
    expect(maskRecipient('joao.silva@clinica.com.br')).toBe(
      'j***@clinica.com.br',
    );
  });

  it('mascara telefone brasileiro, com ou sem prefixo whatsapp', () => {
    expect(maskRecipient('whatsapp:+5511987651234')).toBe('+55 11 9****-1234');
    expect(maskRecipient('5511987651234')).toBe('+55 11 9****-1234');
  });

  it('telefone fora do padrão mostra só os 4 últimos dígitos', () => {
    expect(maskRecipient('+14155550123')).toBe('****0123');
    expect(maskRecipient('123')).toBe('****');
  });

  it('vazio vira travessão', () => {
    expect(maskRecipient(null)).toBe('—');
    expect(maskRecipient('  ')).toBe('—');
  });

  it('nunca devolve o valor original', () => {
    expect(maskRecipient('maria@x.com')).not.toContain('maria');
    expect(maskRecipient('+5511987651234')).not.toContain('987651234');
  });
});

describe('sanitizeDeliveryError', () => {
  it('remove e-mails e telefones da mensagem de erro', () => {
    const out = sanitizeDeliveryError(
      'Falha ao enviar para ana@x.com e +5511987651234: inválido',
    );
    expect(out).toBe('Falha ao enviar para *** e ***: inválido');
  });

  it('trunca mensagens longas e trata vazio', () => {
    expect(sanitizeDeliveryError('a'.repeat(300))?.length).toBe(160);
    expect(sanitizeDeliveryError(null)).toBeNull();
  });
});
