import { Logger } from '@nestjs/common';
import { StorageService } from 'src/shared/storage/storage.service';

const logger = new Logger('SignedUrlTransformer');

/**
 * Transforma os documentos de uma solicitação cirúrgica, substituindo
 * os `uri` internos por URLs assinadas do Supabase.
 */
export async function transformDocumentUrls(
  documents: any[],
  storageService: StorageService,
): Promise<any[]> {
  return Promise.all(
    documents.map(async (doc) => {
      try {
        return {
          ...doc,
          path: doc.uri,
          uri: await storageService.getSignedUrl(doc.uri),
        };
      } catch {
        logger.warn(`Falha ao gerar signed URL para documento ${doc.id ?? doc.uri}`);
        return doc;
      }
    }),
  );
}

/**
 * Transforma a `signature_url` do médico substituindo o path interno
 * por uma URL assinada do Supabase, quando necessário.
 */
export async function transformDoctorSignatureUrl(
  doctor: any,
  storageService: StorageService,
): Promise<any> {
  if (!doctor?.signature_url || doctor.signature_url.startsWith('http')) {
    return doctor;
  }
  try {
    return {
      ...doctor,
      signature_url: await storageService.getSignedUrl(doctor.signature_url),
    };
  } catch {
    logger.warn(`Falha ao gerar signed URL para assinatura do médico ${doctor.id}`);
    return doctor;
  }
}
