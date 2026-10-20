import { BadRequestException } from '@nestjs/common';
import {
  MAX_TENTATIVAS_RECOVERY,
  assertCodigoUtilizavel,
  codigosIguais,
  consumirTentativa,
} from './recovery-code-attempts.util';

function repoAtomico(registro: { attempts: number; used: boolean }) {
  return {
    consumeAttempt: jest.fn(async (_id: string, max: number) => {
      await Promise.resolve();
      if (registro.used || registro.attempts >= max) return null;
      registro.attempts += 1;
      registro.used = registro.attempts >= max;
      return registro.attempts;
    }),
  };
}

describe('Recuperacao de senha — forca bruta do codigo', () => {
  it('invalida o codigo apos 5 tentativas', async () => {
    const registro = { id: 'rec-1', attempts: 0, used: false };
    const repo = repoAtomico(registro);

    const resultados: boolean[] = [];
    for (let i = 0; i < MAX_TENTATIVAS_RECOVERY + 2; i++) {
      resultados.push(await consumirTentativa(repo as any, registro as any));
    }

    expect(resultados.filter(Boolean)).toHaveLength(MAX_TENTATIVAS_RECOVERY);
    expect(registro.attempts).toBe(MAX_TENTATIVAS_RECOVERY);
    expect(registro.used).toBe(true);
  });

  it('tentativas concorrentes nunca passam do limite', async () => {
    const registro = { id: 'rec-2', attempts: 0, used: false };
    const repo = repoAtomico(registro);

    const resultados = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumirTentativa(repo as any, registro as any),
      ),
    );

    expect(resultados.filter(Boolean)).toHaveLength(MAX_TENTATIVAS_RECOVERY);
    expect(repo.consumeAttempt).toHaveBeenCalledWith(
      'rec-2',
      MAX_TENTATIVAS_RECOVERY,
    );
  });

  it('recusa codigo ja invalidado por excesso de tentativas', () => {
    const registro = {
      id: 'rec-3',
      code: '123456',
      used: true,
      attempts: 5,
      expiresAt: new Date(Date.now() + 3600_000),
    };

    expect(() => assertCodigoUtilizavel(registro as any)).toThrow(
      BadRequestException,
    );
  });

  it('recusa codigo expirado ou inexistente', () => {
    expect(() => assertCodigoUtilizavel(null)).toThrow(BadRequestException);
    expect(() =>
      assertCodigoUtilizavel({
        used: false,
        attempts: 0,
        expiresAt: new Date(Date.now() - 1000),
      } as any),
    ).toThrow(BadRequestException);
  });

  it('compara codigos de tamanhos diferentes sem lancar', () => {
    expect(codigosIguais('123456', '123456')).toBe(true);
    expect(codigosIguais('123456', '12345')).toBe(false);
    expect(
      codigosIguais('3f0e7c1a-0000-4000-8000-000000000000', '123456'),
    ).toBe(false);
  });
});
