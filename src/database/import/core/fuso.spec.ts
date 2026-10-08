import { assertProcessoEmUtc } from './fuso';

describe('assertProcessoEmUtc', () => {
  it('passa com o processo em UTC', () => {
    expect(() => assertProcessoEmUtc(0, 'UTC')).not.toThrow();
  });

  it('aborta em São Paulo (offset 180) explicando como rodar', () => {
    expect(() => assertProcessoEmUtc(180, 'America/Sao_Paulo')).toThrow(
      /America\/Sao_Paulo \(UTC-3\).*TZ=UTC/s,
    );
  });

  it('aborta também em fuso positivo', () => {
    expect(() => assertProcessoEmUtc(-120, undefined)).toThrow(/UTC\+2/);
  });
});
