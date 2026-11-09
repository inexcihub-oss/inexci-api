import { maskIpAddresses } from './mask.util';

describe('maskIpAddresses', () => {
  it('troca o último octeto do IPv4 por x', () => {
    expect(maskIpAddresses('login ip=189.40.12.201 falhou')).toBe(
      'login ip=189.40.12.x falhou',
    );
  });

  it('mantém só o prefixo do IPv6', () => {
    expect(maskIpAddresses('ip=2804:14c:65a1:4a2b::1f3')).toBe(
      'ip=2804:14c:65a1::x',
    );
  });

  it('não altera texto sem IP', () => {
    expect(maskIpAddresses('[AUTH_MFA_LOCKED] userId=abc')).toBe(
      '[AUTH_MFA_LOCKED] userId=abc',
    );
  });
});
