import {
  errorClassOf,
  fingerprintOf,
  normalizeMessageForFingerprint,
  normalizeRoute,
  sanitizeErrorMessage,
} from './platform-error-fingerprint';

describe('platform-error-fingerprint', () => {
  it('normaliza ids e números da rota e tira a query string', () => {
    expect(
      normalizeRoute(
        'GET /surgery-requests/3f2a1b4c-1111-4222-8333-444455556666/items/42?x=1',
      ),
    ).toBe('GET /surgery-requests/:id/items/:n');
    expect(normalizeRoute(null)).toBeNull();
  });

  it('o mesmo erro com ids e números diferentes gera a mesma impressão', () => {
    const a = fingerprintOf(
      'http',
      'GET /x/:id',
      'Error',
      new Error(
        'Paciente 3f2a1b4c-1111-4222-8333-444455556666 sem convênio (123)',
      ),
    );
    const b = fingerprintOf(
      'http',
      'GET /x/:id',
      'Error',
      new Error(
        'Paciente 9a9a9a9a-1111-4222-8333-444455556666 sem convênio (987)',
      ),
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('origem, rota ou classe diferentes geram impressões diferentes', () => {
    const erro = new Error('falhou');
    const base = fingerprintOf('http', 'GET /a', 'Error', erro);
    expect(fingerprintOf('queue', 'GET /a', 'Error', erro)).not.toBe(base);
    expect(fingerprintOf('http', 'GET /b', 'Error', erro)).not.toBe(base);
    expect(fingerprintOf('http', 'GET /a', 'TypeError', erro)).not.toBe(base);
  });

  it('a mensagem gravada não leva CPF, e-mail nem telefone', () => {
    const msg = sanitizeErrorMessage(
      new Error(
        'Falha para joao.silva@clinica.com CPF 123.456.789-09 tel (11) 98765-4321 cpf2 12345678909',
      ),
    );
    expect(msg).not.toMatch(/joao|clinica\.com/);
    expect(msg).not.toContain('123.456.789-09');
    expect(msg).not.toContain('12345678909');
    expect(msg).not.toContain('98765-4321');
    expect(msg).toContain('***');
  });

  it('corta mensagens longas em 300 caracteres e ignora vazias', () => {
    expect(sanitizeErrorMessage(new Error('a'.repeat(500)))).toHaveLength(300);
    expect(sanitizeErrorMessage(new Error('   '))).toBeNull();
  });

  it('a normalização da impressão remove e-mails', () => {
    expect(normalizeMessageForFingerprint('X a@b.com Y')).toBe('x :email y');
  });

  it('classe do erro', () => {
    class MeuErro extends Error {}
    expect(errorClassOf(new MeuErro('x'))).toBe('MeuErro');
    expect(errorClassOf('texto')).toBe('string');
    expect(errorClassOf(null)).toBe('null');
  });
});
