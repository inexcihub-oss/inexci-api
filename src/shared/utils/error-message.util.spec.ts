import { errorMessage } from './error-message.util';

describe('errorMessage', () => {
  it('lê a mensagem de um Error', () => {
    expect(errorMessage(new Error('falhou'))).toBe('falhou');
  });

  it('lê a mensagem de um objeto com message string', () => {
    expect(errorMessage({ message: 'objeto' })).toBe('objeto');
  });

  it('converte qualquer outro valor em string', () => {
    expect(errorMessage('texto')).toBe('texto');
    expect(errorMessage(undefined)).toBe('undefined');
    expect(errorMessage({ message: 42 })).toBe('[object Object]');
  });
});
