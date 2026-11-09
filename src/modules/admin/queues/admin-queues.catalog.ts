export const ADMIN_QUEUES = [
  {
    name: 'mail',
    label: 'E-mails',
    description: 'Envio de e-mails da plataforma',
  },
  {
    name: 'whatsapp-messages',
    label: 'WhatsApp',
    description: 'Envio de mensagens de WhatsApp',
  },
  {
    name: 'pdf-generation',
    label: 'PDFs',
    description: 'Geração de PDFs das solicitações cirúrgicas',
  },
  {
    name: 'ai-messages',
    label: 'Assistente de IA',
    description: 'Mensagens recebidas pelo assistente do WhatsApp',
  },
  {
    name: 'document-extraction',
    label: 'Leitura de documentos',
    description: 'Criação de solicitação a partir de documento enviado',
  },
  {
    name: 'indication-documents',
    label: 'Cópia de anexos',
    description: 'Cópia dos documentos do paciente para a solicitação nova',
  },
  {
    name: 'mention-emails',
    label: 'Avisos de menção',
    description: 'E-mails de quem foi mencionado em comentários',
  },
] as const;

export type AdminQueueName = (typeof ADMIN_QUEUES)[number]['name'];

export const ADMIN_QUEUE_NAMES: readonly AdminQueueName[] = ADMIN_QUEUES.map(
  (q) => q.name,
);

export function isAdminQueueName(value: string): value is AdminQueueName {
  return (ADMIN_QUEUE_NAMES as readonly string[]).includes(value);
}
