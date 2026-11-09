import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PlatformAdminInvite } from 'src/database/repositories/platform-admin.repository';

export const ADMIN_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function inviteTokenConfere(
  token: string,
  hashGravado: string | null | undefined,
): boolean {
  if (!hashGravado) return false;
  const recebido = Buffer.from(hashInviteToken(token), 'hex');
  const esperado = Buffer.from(hashGravado, 'hex');
  return (
    recebido.length === esperado.length && timingSafeEqual(recebido, esperado)
  );
}

export function generateAdminInvite(now: number = Date.now()): {
  token: string;
  invite: PlatformAdminInvite;
} {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    invite: {
      inviteTokenHash: hashInviteToken(token),
      inviteExpiresAt: new Date(now + ADMIN_INVITE_TTL_MS),
    },
  };
}

export function buildAdminInviteLink(
  dashboardUrl: string | undefined,
  email: string,
  token: string,
): string {
  const base = (dashboardUrl ?? '').replace(/\/+$/, '');
  return `${base}/admin/primeiro-acesso#email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
}
