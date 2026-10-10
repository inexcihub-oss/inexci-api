import { Logger } from '@nestjs/common';
import { StorageService } from 'src/shared/storage/storage.service';

const logger = new Logger('SignedUrlTransformer');

interface DocumentoComUri {
  id?: string;
  uri: string | null;
}

interface MedicoComAssinatura {
  id?: string;
  signatureUrl?: string | null;
  doctorProfile?: {
    signatureUrl?: string | null;
    header?: { logoUrl?: string | null } | null;
  } | null;
}

export function transformDocumentUrls<T extends DocumentoComUri>(
  documents: T[],
  storageService: StorageService,
): Promise<T[]> {
  return Promise.all(
    documents.map(async (doc) => {
      try {
        if (doc.uri === null) throw new Error('documento sem uri');
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

export async function transformDoctorSignatureUrl<
  T extends MedicoComAssinatura,
>(doctor: T, storageService: StorageService): Promise<T> {
  const rawSignature: string | undefined =
    doctor?.doctorProfile?.signatureUrl || doctor?.signatureUrl || undefined;

  if (!rawSignature) {
    return resolveHeaderLogoUrl(doctor, storageService);
  }

  const withSignedSignature = (signedUrl: string): T => ({
    ...doctor,
    signatureUrl: signedUrl,
    doctorProfile: doctor.doctorProfile
      ? { ...doctor.doctorProfile, signatureUrl: signedUrl }
      : doctor.doctorProfile,
  });

  let transformed: T;
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

async function resolveHeaderLogoUrl<T extends MedicoComAssinatura>(
  doctor: T,
  storageService: StorageService,
): Promise<T> {
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
