import { BadRequestException } from '@nestjs/common';
import { RecoveryCode } from 'src/database/entities/recovery-code.entity';
import { RecoveryCodeRepository } from 'src/database/repositories/recovery-code.repository';

/** Tentativas permitidas por codigo antes da invalidacao definitiva. */
export const MAX_TENTATIVAS_RECOVERY = 5;

/**
 * Recusa codigos ja consumidos, expirados ou invalidados por excesso de
 * tentativas. Mensagem generica de proposito (anti-enumeration).
 */
export function assertCodigoUtilizavel(registro: RecoveryCode | null): void {
  if (!registro || registro.used) {
    throw new BadRequestException('Código inválido ou expirado');
  }
  if (registro.expiresAt && registro.expiresAt.getTime() < Date.now()) {
    throw new BadRequestException('Código inválido ou expirado');
  }
  if ((registro.attempts ?? 0) >= MAX_TENTATIVAS_RECOVERY) {
    throw new BadRequestException('Código inválido ou expirado');
  }
}

/**
 * Incrementa o contador de tentativas. Ao atingir o teto, marca o codigo como
 * usado para que nenhuma tentativa posterior seja aceita.
 */
export async function consumirTentativa(
  repo: RecoveryCodeRepository,
  registro: RecoveryCode,
): Promise<void> {
  const tentativas = (registro.attempts ?? 0) + 1;
  await repo.update(registro.id, {
    attempts: tentativas,
    ...(tentativas >= MAX_TENTATIVAS_RECOVERY && { used: true }),
  });
}
