import { ConfigService } from '@nestjs/config';
import DOCUMENT_TYPES from '../../../../common/document-types.common';
import { DOCUMENT_KEYS } from '../../../constants/document-keys';
import { downloadTwilioInboundMedia } from './twilio-media-download';
import { asNonEmptyString } from './arg-parsers';

export const REPORT_IMAGE_KEY = DOCUMENT_KEYS.REPORT_IMAGES;
export const REPORT_IMAGE_TYPE = 'exam_image';

export const SUPPORTED_ATTACH_DOCUMENT_TYPES = Object.values(DOCUMENT_TYPES);

export function classifyDocumentType(
  contentType: string | null | undefined,
  providedType: unknown,
): string {
  const typed = asNonEmptyString(providedType);
  if (typed) return typed;

  const mime = (contentType || '').toLowerCase();
  if (mime.includes('pdf')) return 'medical_report';
  if (mime.startsWith('image/')) return 'exam_image';
  if (mime.includes('word') || mime.includes('officedocument')) {
    return 'report_document';
  }
  return 'other_document';
}

export async function downloadInboundMedia(
  url: string,
  configService?: ConfigService,
): Promise<{ buffer: Buffer; contentType: string | null; fileName: string }> {
  return downloadTwilioInboundMedia(url, configService, 'media');
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  personal_document: 'Documento pessoal',
  exam_report: 'Laudo de exame',
  medical_report: 'Laudo médico',
  authorization_guide: 'Guia de autorização',
  surgery_room: 'Sala cirúrgica',
  surgery_images: 'Imagens da cirurgia',
  surgery_auth_document: 'Autorização cirúrgica',
  invoice_protocol: 'Protocolo de faturamento',
  receipt_document: 'Comprovante de recebimento',
  contest_file: 'Anexo de contestação',
  additional_document: 'Documento adicional',
};

export function documentTypeKeyToLabel(typeKey: string): string {
  return DOCUMENT_TYPE_LABELS[typeKey] ?? typeKey;
}
