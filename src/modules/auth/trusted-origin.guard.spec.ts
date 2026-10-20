import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrustedOriginGuard } from './trusted-origin.guard';

function contexto(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('TrustedOriginGuard', () => {
  const guard = new TrustedOriginGuard({
    get: () => 'https://app.inexci.com.br/, https://api.inexci.com.br',
  } as unknown as ConfigService);

  it('aceita a origem do frontend listada em CORS_ORIGINS', () => {
    expect(
      guard.canActivate(contexto({ origin: 'https://app.inexci.com.br' })),
    ).toBe(true);
  });

  it('recusa origem fora de CORS_ORIGINS', () => {
    expect(() =>
      guard.canActivate(contexto({ origin: 'https://evil.example' })),
    ).toThrow(ForbiddenException);
  });

  it('recusa requisição cross-site sem Origin', () => {
    expect(() =>
      guard.canActivate(contexto({ 'sec-fetch-site': 'cross-site' })),
    ).toThrow(ForbiddenException);
  });

  it('aceita cliente sem Origin (curl, healthcheck) e same-site', () => {
    expect(guard.canActivate(contexto({}))).toBe(true);
    expect(guard.canActivate(contexto({ 'sec-fetch-site': 'same-site' }))).toBe(
      true,
    );
  });
});
