import { Injectable } from '@nestjs/common';
import { UserRepository } from 'src/database/repositories/user.repository';
import { DoctorHeaderRepository } from 'src/database/repositories/doctor-header.repository';
import { StorageService } from 'src/shared/storage/storage.service';
import { CustomHeaderData } from './pdf.service';
import { User } from 'src/database/entities/user.entity';
import { DoctorProfile } from 'src/database/entities/doctor-profile.entity';

export function formatarRegistroProfissional(
  profile:
    | { council?: string | null; crm?: string | null; crmState?: string | null }
    | null
    | undefined,
): string | undefined {
  if (!profile?.crm) return undefined;
  const conselho = profile.council || 'CRM';
  return `${conselho} ${profile.crm}${profile.crmState ? `/${profile.crmState}` : ''}`;
}

export interface DoctorPdfContext {
  doctor: User;
  profile: DoctorProfile | null | undefined;
  doctorCrm?: string;
  doctorSignatureUrl?: string;
  customHeader: CustomHeaderData | null;
}

@Injectable()
export class DoctorPdfContextService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly doctorHeaderRepository: DoctorHeaderRepository,
    private readonly storageService: StorageService,
  ) {}

  async buildForDoctorId(doctorId: string): Promise<DoctorPdfContext> {
    const doctor = await this.userRepository.findOneWithProfile({
      id: doctorId,
    });
    if (!doctor) {
      throw new Error(`Médico não encontrado para geração de PDF: ${doctorId}`);
    }
    return this.buildForDoctor(doctor);
  }

  async buildForDoctor(doctor: User): Promise<DoctorPdfContext> {
    const profile = doctor?.doctorProfile;

    const doctorCrm = formatarRegistroProfissional(profile);

    const doctorSignatureUrl = await this.resolveSignatureUrl(profile);
    const customHeader = await this.resolveCustomHeader(profile);

    return { doctor, profile, doctorCrm, doctorSignatureUrl, customHeader };
  }

  async resolveSignatureUrl(
    profile: DoctorProfile | null | undefined,
  ): Promise<string | undefined> {
    if (!profile?.signatureUrl) return undefined;
    const raw: string = profile.signatureUrl;
    if (raw.startsWith('http')) return raw;
    try {
      return await this.storageService.getSignedUrl(raw);
    } catch {
      return undefined;
    }
  }

  async resolveCustomHeader(
    profile: DoctorProfile | null | undefined,
  ): Promise<CustomHeaderData | null> {
    if (!profile?.id) return null;

    const header =
      profile.header ??
      (await this.doctorHeaderRepository.findByDoctorProfileId(profile.id));
    if (!header) return null;

    let logoUrl: string | null = null;
    if (header.logoUrl) {
      if (header.logoUrl.startsWith('http')) {
        logoUrl = header.logoUrl;
      } else {
        try {
          logoUrl = await this.storageService.getSignedUrl(header.logoUrl);
        } catch {
          logoUrl = null;
        }
      }
    }

    return {
      logoUrl,
      logoPosition: header.logoPosition,
      contentHtml: header.contentHtml,
    };
  }
}
