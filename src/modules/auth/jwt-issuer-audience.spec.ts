import { JwtService } from '@nestjs/jwt';
import {
  JWT_DEFAULT_AUDIENCE,
  JWT_DEFAULT_ISSUER,
} from './jwt-payload.interface';

/**
 * Contrato de issuer/audience: o access token é assinado com `iss`/`aud`
 * (signOptions do JwtModule) e a verificação (espelhando o `JwtStrategy`)
 * rejeita tokens emitidos por outra origem.
 */
describe('JWT issuer/audience', () => {
  const secret = 'test-secret';

  const signer = new JwtService({
    secret,
    signOptions: {
      expiresIn: '15m',
      issuer: JWT_DEFAULT_ISSUER,
      audience: JWT_DEFAULT_AUDIENCE,
    },
  });

  const verifier = new JwtService({ secret });
  const verifyOpts = {
    issuer: JWT_DEFAULT_ISSUER,
    audience: JWT_DEFAULT_AUDIENCE,
  };

  it('token assinado com iss/aud corretos é aceito e carrega userId', () => {
    const token = signer.sign({ userId: 'user-1' });
    const payload = verifier.verify(token, verifyOpts);
    expect(payload.userId).toBe('user-1');
    expect(payload.iss).toBe(JWT_DEFAULT_ISSUER);
    expect(payload.aud).toBe(JWT_DEFAULT_AUDIENCE);
  });

  it('token sem iss/aud (origem desconhecida) é rejeitado', () => {
    const foreign = new JwtService({ secret });
    const token = foreign.sign({ userId: 'user-1' });
    expect(() => verifier.verify(token, verifyOpts)).toThrow();
  });

  it('token com audience divergente é rejeitado', () => {
    const wrong = new JwtService({
      secret,
      signOptions: { issuer: JWT_DEFAULT_ISSUER, audience: 'outro-app' },
    });
    const token = wrong.sign({ userId: 'user-1' });
    expect(() => verifier.verify(token, verifyOpts)).toThrow();
  });
});
