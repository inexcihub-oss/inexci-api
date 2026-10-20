export type ConsentType = 'privacy_policy' | 'terms_of_use' | 'ai';

export const REQUIRED_CONSENTS: ConsentType[] = [
  'privacy_policy',
  'terms_of_use',
];

export const CONSENT_DOCUMENT_FILE: Record<ConsentType, string> = {
  privacy_policy: 'privacy-policy',
  terms_of_use: 'terms-of-use',
  ai: 'ai-disclosure',
};
