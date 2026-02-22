/**
 * Configuração de e-mail via Nodemailer (SMTP genérico).
 * As credenciais são lidas das variáveis de ambiente.
 */
export const mailConfig = {
  host: process.env.MAIL_HOST || 'smtp.example.com',
  port: parseInt(process.env.MAIL_PORT || '587', 10),
  secure: process.env.MAIL_SECURE === 'true',
  auth: {
    user: process.env.MAIL_USER || '',
    pass: process.env.MAIL_PASS || '',
  },
  from: {
    name: process.env.MAIL_FROM_NAME || 'Inexci',
    address: process.env.MAIL_FROM_ADDRESS || 'noreply@inexci.com.br',
  },
};

/**
 * Templates de e-mail disponíveis.
 * Usados para validar o template solicitado no endpoint POST /notify.
 */
export type MailTemplateName =
  | 'surgery-request-sent'
  | 'surgery-authorized'
  | 'surgery-contested'
  | 'surgery-scheduled'
  | 'invoice-sent'
  | 'payment-received'
  | 'payment-contested';

export const MAIL_TEMPLATES: MailTemplateName[] = [
  'surgery-request-sent',
  'surgery-authorized',
  'surgery-contested',
  'surgery-scheduled',
  'invoice-sent',
  'payment-received',
  'payment-contested',
];
