import { ConsentType } from '../database/entities/consent-log.entity';

/**
 * Versão vigente de cada termo legal. Bumps:
 *
 * - **MAJOR** (1.0 → 2.0): mudança material; usuários precisam reaceitar.
 * - **MINOR** (1.0 → 1.1): correção redacional; aceite anterior continua válido.
 *
 * O agente de aceite compara apenas o MAJOR via `isConsentVersionValid`.
 */
export const CURRENT_CONSENT_VERSIONS: Record<ConsentType, string> = {
  privacy_policy: '1.0',
  terms_of_use: '1.0',
  ai: '1.0',
};

/**
 * Quais consentimentos são obrigatórios para usar a plataforma.
 * IA é opcional — usuário pode usar sem ela.
 */
export const REQUIRED_CONSENTS: ConsentType[] = [
  'privacy_policy',
  'terms_of_use',
];

/**
 * Slug do arquivo markdown publicado por consentimento.
 * Usado por `LegalDocumentsService` para servir o conteúdo atual via
 * GET /privacy/policy/:slug.
 */
export const CONSENT_DOCUMENT_FILE: Record<ConsentType, string> = {
  privacy_policy: 'privacy-policy',
  terms_of_use: 'terms-of-use',
  ai: 'ai-disclosure',
};

/** Compara apenas o MAJOR. */
export function isConsentVersionValid(
  acceptedVersion: string | null | undefined,
  currentVersion: string,
): boolean {
  if (!acceptedVersion) return false;
  const acceptedMajor = acceptedVersion.split('.')[0];
  const currentMajor = currentVersion.split('.')[0];
  return acceptedMajor === currentMajor;
}
