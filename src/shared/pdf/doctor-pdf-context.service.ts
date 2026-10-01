import { Injectable } from '@nestjs/common';
import { UserRepository } from 'src/database/repositories/user.repository';
import { DoctorHeaderRepository } from 'src/database/repositories/doctor-header.repository';
import { StorageService } from 'src/shared/storage/storage.service';
import { CustomHeaderData } from './pdf.service';

/**
 * `CRM 12345/RJ`. Sem número, nada é impresso (como antes). Perfil antigo sem
 * `council` carregado é CRM — aqui é só exibição, não decide permissão.
 */
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
  doctor: any;
  profile: any;
  /**
   * Registro no conselho já formatado para impressão (ex.: `CRM 12345/RJ`,
   * `CRN 4567/RJ`). Nome histórico `doctorCrm`: os templates `.hbs` o usam.
   */
  doctorCrm?: string;
  doctorSignatureUrl?: string;
  customHeader: CustomHeaderData | null;
}

/**
 * Dados do médico usados no cabeçalho e no rodapé de qualquer PDF assinado
 * (laudo, contestação, receita, atestado, encaminhamento de exames).
 *
 * Vive em `shared/pdf` porque não é específico da solicitação cirúrgica: o
 * módulo de atendimento precisa exatamente do mesmo bloco — nome, CRM,
 * assinatura e cabeçalho customizado do médico responsável.
 */
@Injectable()
export class DoctorPdfContextService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly doctorHeaderRepository: DoctorHeaderRepository,
    private readonly storageService: StorageService,
  ) {}

  /** Carrega o médico pelo id e monta o contexto de PDF. */
  async buildForDoctorId(doctorId: string): Promise<DoctorPdfContext> {
    const doctor = await this.userRepository.findOneWithProfile({
      id: doctorId,
    });
    if (!doctor) {
      throw new Error(`Médico não encontrado para geração de PDF: ${doctorId}`);
    }
    return this.buildForDoctor(doctor);
  }

  /** Monta o contexto a partir de um médico já carregado (com `doctorProfile`). */
  async buildForDoctor(doctor: any): Promise<DoctorPdfContext> {
    const profile = doctor?.doctorProfile;

    const doctorCrm = formatarRegistroProfissional(profile);

    const doctorSignatureUrl = await this.resolveSignatureUrl(profile);
    const customHeader = await this.resolveCustomHeader(profile);

    return { doctor, profile, doctorCrm, doctorSignatureUrl, customHeader };
  }

  /** URL da assinatura do médico (assinada quando é um path do storage). */
  async resolveSignatureUrl(profile: any): Promise<string | undefined> {
    if (!profile?.signatureUrl) return undefined;
    const raw: string = profile.signatureUrl;
    if (raw.startsWith('http')) return raw;
    try {
      return await this.storageService.getSignedUrl(raw);
    } catch {
      return undefined;
    }
  }

  /** Cabeçalho customizado (logo + HTML livre) configurado pelo médico. */
  async resolveCustomHeader(profile: any): Promise<CustomHeaderData | null> {
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
