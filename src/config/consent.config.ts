/**
 * Configuração simples de consentimentos LGPD.
 *
 * Não há versionamento: a aceitação é única e fica registrada nos campos
 * `*_accepted_at` da tabela `users`. Bumps de conteúdo dos arquivos legais
 * são tratados editorialmente — caso seja necessário forçar reaceite,
 * basta zerar o campo correspondente em `users` (ex.: via migration).
 */

export type ConsentType = 'privacy_policy' | 'terms_of_use' | 'ai';

export const REQUIRED_CONSENTS: ConsentType[] = [
  'privacy_policy',
  'terms_of_use',
];

/**
 * Slug usado nos arquivos markdown servidos por `LegalDocumentsService`
 * em `GET /privacy/policy/:slug` e nas páginas públicas do frontend.
 */
export const CONSENT_DOCUMENT_FILE: Record<ConsentType, string> = {
  privacy_policy: 'privacy-policy',
  terms_of_use: 'terms-of-use',
  ai: 'ai-disclosure',
};
