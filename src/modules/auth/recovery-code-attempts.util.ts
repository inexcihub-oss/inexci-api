import { BadRequestException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { RecoveryCode } from 'src/database/entities/recovery-code.entity';
import { RecoveryCodeRepository } from 'src/database/repositories/recovery-code.repository';

export const MAX_TENTATIVAS_RECOVERY = 5;

export function codigoInvalido(): BadRequestException {
  return new BadRequestException('Código inválido ou expirado');
}

export function assertCodigoUtilizavel(
  registro: RecoveryCode | null,
): asserts registro is RecoveryCode {
  if (!registro || registro.used) {
    throw codigoInvalido();
  }
  if (registro.expiresAt && registro.expiresAt.getTime() < Date.now()) {
    throw codigoInvalido();
  }
  if ((registro.attempts ?? 0) >= MAX_TENTATIVAS_RECOVERY) {
    throw codigoInvalido();
  }
}

export async function consumirTentativa(
  repo: RecoveryCodeRepository,
  registro: RecoveryCode,
): Promise<boolean> {
  const tentativas = await repo.consumeAttempt(
    registro.id,
    MAX_TENTATIVAS_RECOVERY,
  );
  return tentativas !== null;
}

function digest(valor: string): Buffer {
  return createHash('sha256').update(valor, 'utf8').digest();
}

export function codigosIguais(esperado: string, recebido: string): boolean {
  return timingSafeEqual(digest(esperado), digest(recebido));
}
