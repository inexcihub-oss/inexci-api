import { BadRequestException } from '@nestjs/common';
import { RecoveryCode } from 'src/database/entities/recovery-code.entity';
import { RecoveryCodeRepository } from 'src/database/repositories/recovery-code.repository';

export const MAX_TENTATIVAS_RECOVERY = 5;

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
