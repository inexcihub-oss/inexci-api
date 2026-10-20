import { createHmac, hkdfSync, randomInt, timingSafeEqual } from 'crypto';

export const MFA_RECOVERY_CODE_COUNT = 10;
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TAMANHO = 10;

export function deriveRecoveryPepper(segredo: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', segredo, 'inexci-mfa', 'mfa-recovery-codes', 32),
  );
}

export function normalizeRecoveryCode(code: string): string {
  return (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isRecoveryCodeFormat(code: string): boolean {
  const normalizado = normalizeRecoveryCode(code);
  return (
    normalizado.length === TAMANHO &&
    [...normalizado].every((c) => ALFABETO.includes(c))
  );
}

function gerarCodigo(): string {
  let bruto = '';
  for (let i = 0; i < TAMANHO; i++) {
    bruto += ALFABETO[randomInt(ALFABETO.length)];
  }
  return `${bruto.slice(0, 5)}-${bruto.slice(5)}`;
}

export function generateRecoveryCodes(
  quantidade: number = MFA_RECOVERY_CODE_COUNT,
): string[] {
  const codigos = new Set<string>();
  while (codigos.size < quantidade) {
    codigos.add(gerarCodigo());
  }
  return [...codigos];
}

export function hashRecoveryCode(code: string, pepper: Buffer): string {
  return createHmac('sha256', pepper)
    .update(normalizeRecoveryCode(code))
    .digest('hex');
}

export function findRecoveryCodeHash(
  hashes: readonly string[] | null | undefined,
  candidato: string,
): string | null {
  const alvo = Buffer.from(candidato, 'hex');
  let encontrado: string | null = null;
  for (const hash of hashes ?? []) {
    const atual = Buffer.from(hash, 'hex');
    if (atual.length === alvo.length && timingSafeEqual(atual, alvo)) {
      encontrado = hash;
    }
  }
  return encontrado;
}
