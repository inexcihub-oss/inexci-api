import {
  MFA_RECOVERY_CODE_COUNT,
  deriveRecoveryPepper,
  findRecoveryCodeHash,
  generateRecoveryCodes,
  hashRecoveryCode,
  isRecoveryCodeFormat,
  normalizeRecoveryCode,
} from './mfa-recovery-codes.util';

describe('códigos de recuperação do MFA', () => {
  const pepper = deriveRecoveryPepper('segredo-de-teste');

  it('gera 10 códigos distintos no formato XXXXX-XXXXX', () => {
    const codigos = generateRecoveryCodes();
    expect(codigos).toHaveLength(MFA_RECOVERY_CODE_COUNT);
    expect(new Set(codigos).size).toBe(MFA_RECOVERY_CODE_COUNT);
    for (const codigo of codigos) {
      expect(codigo).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      expect(isRecoveryCodeFormat(codigo)).toBe(true);
    }
  });

  it('normaliza caixa, hífen e espaços', () => {
    expect(normalizeRecoveryCode(' abcde-fgh23 ')).toBe('ABCDEFGH23');
    expect(isRecoveryCodeFormat('abcde fgh23')).toBe(true);
    expect(isRecoveryCodeFormat('123456')).toBe(false);
  });

  it('o hash independe da formatação digitada', () => {
    expect(hashRecoveryCode('ABCDE-FGH23', pepper)).toBe(
      hashRecoveryCode('abcdefgh23', pepper),
    );
  });

  it('o hash depende do pepper (HMAC, não SHA-256 puro)', () => {
    const outro = deriveRecoveryPepper('outro-segredo');
    expect(hashRecoveryCode('ABCDE-FGH23', pepper)).not.toBe(
      hashRecoveryCode('ABCDE-FGH23', outro),
    );
    expect(pepper).toHaveLength(32);
  });

  it('encontra o hash correspondente e ignora os demais', () => {
    const hashes = ['AAAAA-BBBBB', 'CCCCC-DDDDD'].map((c) =>
      hashRecoveryCode(c, pepper),
    );
    expect(
      findRecoveryCodeHash(hashes, hashRecoveryCode('ccccc-ddddd', pepper)),
    ).toBe(hashes[1]);
    expect(
      findRecoveryCodeHash(hashes, hashRecoveryCode('EEEEE-FFFFF', pepper)),
    ).toBeNull();
    expect(findRecoveryCodeHash(null, hashes[0])).toBeNull();
  });
});
