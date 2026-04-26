import { Logger } from '@nestjs/common';
import { StorageService } from 'src/shared/storage/storage.service';

const logger = new Logger('SignedUrlTransformer');

/**
 * Transforma os documentos de uma solicitação cirúrgica, substituindo
 * os `uri` internos por URLs assinadas do Supabase.
 */
export function transformDocumentUrls(
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
        logger.warn(
          `Falha ao gerar signed URL para documento ${doc.id ?? doc.uri}`,
        );
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
  // A assinatura fica em doctor.doctor_profile.signature_url (path bruto).
  // Promove para doctor.signature_url como signed URL para uso no frontend.
  const rawSignature: string | undefined =
    doctor?.doctor_profile?.signature_url || doctor?.signature_url;

  if (!rawSignature) {
    // Mesmo sem assinatura, resolve o logo do cabeçalho se houver
    return resolveHeaderLogoUrl(doctor, storageService);
  }

  let transformed: any;
  if (rawSignature.startsWith('http')) {
    // Já é uma URL HTTP — apenas garante que está no campo top-level
    transformed = { ...doctor, signature_url: rawSignature };
  } else {
    try {
      transformed = {
        ...doctor,
        signature_url: await storageService.getSignedUrl(rawSignature),
      };
    } catch {
      logger.warn(
        `Falha ao gerar signed URL para assinatura do médico ${doctor.id}`,
      );
      transformed = doctor;
    }
  }

  return resolveHeaderLogoUrl(transformed, storageService);
}

/**
 * Resolve a URL assinada do logo do cabeçalho customizado do médico,
 * quando houver um path bruto armazenado.
 */
async function resolveHeaderLogoUrl(
  doctor: any,
  storageService: StorageService,
): Promise<any> {
  const header = doctor?.doctor_profile?.header;
  if (!header?.logo_url || header.logo_url.startsWith('http')) {
    return doctor;
  }

  try {
    const signedLogoUrl = await storageService.getSignedUrl(header.logo_url);
    return {
      ...doctor,
      doctor_profile: {
        ...doctor.doctor_profile,
        header: { ...header, logo_url: signedLogoUrl },
      },
    };
  } catch {
    logger.warn(
      `Falha ao gerar signed URL para logo do cabeçalho do médico ${doctor.id}`,
    );
    return doctor;
  }
}
