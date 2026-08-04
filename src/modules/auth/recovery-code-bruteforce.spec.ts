import { BadRequestException } from '@nestjs/common';

/**
 * Numero maximo de tentativas por codigo de recuperacao antes da invalidacao.
 * Sem esse limite, 10^6 combinacoes sao forcaveis dentro da janela de validade.
 */
const MAX_TENTATIVAS = 5;

describe('Recuperacao de senha — forca bruta do codigo', () => {
  it('invalida o codigo apos 5 tentativas erradas', async () => {
    const registro = {
      id: 'rec-1',
      userId: 'user-1',
      code: '123456',
      used: false,
      attempts: 0,
      expiresAt: new Date(Date.now() + 3600_000),
    };

    const repo = {
      findOne: jest.fn().mockResolvedValue(registro),
      update: jest.fn().mockImplementation((id, dados) => {
        Object.assign(registro, dados);
        return Promise.resolve(registro);
      }),
    };

    const { consumirTentativa } = await import(
      './recovery-code-attempts.util'
    );

    // 5 tentativas erradas: a quinta deve marcar o codigo como usado.
    for (let i = 0; i < MAX_TENTATIVAS; i++) {
      await consumirTentativa(repo as any, registro as any);
    }

    expect(registro.attempts).toBe(MAX_TENTATIVAS);
    expect(registro.used).toBe(true);
  });

  it('recusa codigo ja invalidado por excesso de tentativas', async () => {
    const registro = {
      id: 'rec-2',
      userId: 'user-2',
      code: '123456',
      used: true,
      attempts: 5,
      expiresAt: new Date(Date.now() + 3600_000),
    };

    const { assertCodigoUtilizavel } = await import(
      './recovery-code-attempts.util'
    );

    expect(() => assertCodigoUtilizavel(registro as any)).toThrow(
      BadRequestException,
    );
  });
});
