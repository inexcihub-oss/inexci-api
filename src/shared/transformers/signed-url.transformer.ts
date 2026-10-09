import { Logger } from '@nestjs/common';
import { StorageService } from 'src/shared/storage/storage.service';

const logger = new Logger('SignedUrlTransformer');

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

export async function transformDoctorSignatureUrl(
  doctor: any,
  storageService: StorageService,
): Promise<any> {
  const rawSignature: string | undefined =
    doctor?.doctorProfile?.signatureUrl || doctor?.signatureUrl;

  if (!rawSignature) {
    return resolveHeaderLogoUrl(doctor, storageService);
  }

  const withSignedSignature = (signedUrl: string) => ({
    ...doctor,
    signatureUrl: signedUrl,
    doctorProfile: doctor.doctorProfile
      ? { ...doctor.doctorProfile, signatureUrl: signedUrl }
      : doctor.doctorProfile,
  });

  let transformed: any;
  if (rawSignature.startsWith('http')) {
    transformed = withSignedSignature(rawSignature);
  } else {
    try {
      transformed = withSignedSignature(
        await storageService.getSignedUrl(rawSignature),
      );
    } catch {
      logger.warn(
        `Falha ao gerar signed URL para assinatura do médico ${doctor.id}`,
      );
      transformed = withSignedSignature(rawSignature);
    }
  }

  return resolveHeaderLogoUrl(transformed, storageService);
}

async function resolveHeaderLogoUrl(
  doctor: any,
  storageService: StorageService,
): Promise<any> {
  const header = doctor?.doctorProfile?.header;
  if (!header?.logoUrl || header.logoUrl.startsWith('http')) {
    return doctor;
  }

  try {
    const signedLogoUrl = await storageService.getSignedUrl(header.logoUrl);
    return {
      ...doctor,
      doctorProfile: {
        ...doctor.doctorProfile,
        header: { ...header, logoUrl: signedLogoUrl },
      },
    };
  } catch {
    logger.warn(
      `Falha ao gerar signed URL para logo do cabeçalho do médico ${doctor.id}`,
    );
    return doctor;
  }
}
