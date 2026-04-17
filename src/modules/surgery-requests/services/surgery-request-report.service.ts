import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReportSection } from 'src/database/entities/report-section.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { StorageService } from 'src/shared/storage/storage.service';
import {
  PdfService,
  SurgeryRequestLaudoPdfData,
} from 'src/shared/pdf/pdf.service';
import { CreateReportSectionDto } from '../dto/create-report-section.dto';
import { UpdateReportSectionDto } from '../dto/update-report-section.dto';
import { ReorderReportSectionsDto } from '../dto/reorder-report-sections.dto';
import { DOCUMENT_KEYS } from 'src/shared/constants/document-keys';

@Injectable()
export class SurgeryRequestReportService {
  private readonly logger = new Logger(SurgeryRequestReportService.name);

  constructor(
    @InjectRepository(ReportSection)
    private readonly reportSectionRepository: Repository<ReportSection>,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly userRepository: UserRepository,
    private readonly storageService: StorageService,
    private readonly pdfService: PdfService,
  ) {}

  async getReportSections(
    id: string,
    _userId: string,
  ): Promise<ReportSection[]> {
    return this.reportSectionRepository.find({
      where: { surgery_request_id: id },
      order: { order: 'ASC' },
    });
  }

  async createReportSection(
    id: string,
    dto: CreateReportSectionDto,
    _userId: string,
  ): Promise<ReportSection> {
    const count = await this.reportSectionRepository.count({
      where: { surgery_request_id: id },
    });
    const section = this.reportSectionRepository.create({
      surgery_request_id: id,
      title: dto.title,
      description: dto.description ?? null,
      order: count,
    });
    return this.reportSectionRepository.save(section);
  }

  async updateReportSection(
    _id: string,
    sectionId: string,
    dto: UpdateReportSectionDto,
    _userId: string,
  ): Promise<ReportSection> {
    const section = await this.reportSectionRepository.findOne({
      where: { id: sectionId },
    });
    if (!section) throw new NotFoundException('Seção não encontrada');
    if (dto.title !== undefined) section.title = dto.title;
    if (dto.description !== undefined) section.description = dto.description;
    return this.reportSectionRepository.save(section);
  }

  async deleteReportSection(
    _id: string,
    sectionId: string,
    _userId: string,
  ): Promise<{ deleted: boolean }> {
    const result = await this.reportSectionRepository.delete({ id: sectionId });
    return { deleted: (result.affected ?? 0) > 0 };
  }

  async reorderReportSections(
    id: string,
    dto: ReorderReportSectionsDto,
    _userId: string,
  ): Promise<ReportSection[]> {
    const updates = dto.ids.map((sectionId, index) =>
      this.reportSectionRepository.update(
        { id: sectionId, surgery_request_id: id },
        { order: index },
      ),
    );
    await Promise.all(updates);
    return this.getReportSections(id, _userId);
  }

  async generateReportPdf(id: string, userId: string): Promise<Buffer> {
    const request = await this.surgeryRequestRepository.findOneWithRelations(
      { id },
      [
        'created_by',
        'patient',
        'hospital',
        'health_plan',
        'tuss_items',
        'opme_items',
        'documents',
        'analysis',
        'billing',
        'contestations',
      ],
    );
    if (!request) throw new NotFoundException('Solicitação não encontrada');

    // ── Parsear medical_report ─────────────────────────────────────────────
    let reportData: {
      patientData?: {
        name?: string;
        birthDate?: string;
        rg?: string;
        cpf?: string;
        phone?: string;
        address?: string;
        zipCode?: string;
        healthPlan?: string;
      };
      historyAndDiagnosis?: string;
      conduct?: string;
    } = {};
    try {
      if (request.medical_report) {
        reportData = JSON.parse(request.medical_report as unknown as string);
      }
    } catch {
      // fallback vazio
    }

    // ── Dados do médico com perfil ─────────────────────────────────────────
    const doctor = await this.userRepository.findOneWithProfile({ id: userId });
    const profile = doctor?.doctor_profile;

    // ── Imagens dos exames (signed URLs) ───────────────────────────────────
    const allDocs = request.documents ?? [];
    this.logger.log(
      `[PDF] Total documents: ${allDocs.length} | keys: ${allDocs.map((d: any) => d.key).join(', ')}`,
    );
    const examDocs = allDocs.filter(
      (d: any) => d.key === DOCUMENT_KEYS.REPORT_IMAGES,
    );
    this.logger.log(
      `[PDF] examDocs count: ${examDocs.length} | uris: ${examDocs.map((d: any) => String(d.uri).substring(0, 80)).join(' | ')}`,
    );
    const examImages: string[] = (
      await Promise.all(
        examDocs.map(async (doc: any) => {
          const raw: string = doc.uri;
          if (!raw) return null;
          if (raw.startsWith('http')) {
            this.logger.log(`[PDF] image already signed URL, using directly`);
            return raw;
          }
          try {
            const signed = await this.storageService.getSignedUrl(raw);
            this.logger.log(`[PDF] signed URL generated OK`);
            return signed;
          } catch (err: any) {
            this.logger.warn(
              `[PDF] getSignedUrl failed for "${raw}": ${err?.message}`,
            );
            return null;
          }
        }),
      )
    ).filter((u): u is string => !!u);
    this.logger.log(`[PDF] final examImages count: ${examImages.length}`);

    // ── Assinatura do médico (signed URL se for path) ──────────────────────
    let doctorSignatureUrl: string | undefined;
    if (profile?.signature_url) {
      try {
        const raw: string = profile.signature_url;
        doctorSignatureUrl = raw.startsWith('http')
          ? raw
          : await this.storageService.getSignedUrl(raw);
      } catch {
        doctorSignatureUrl = profile.signature_url;
      }
    }

    // ── Seções dinâmicas do laudo ──────────────────────────────────────────
    const reportSections = await this.reportSectionRepository.find({
      where: { surgery_request_id: id },
      order: { order: 'ASC' },
    });

    // ── Dados do paciente (prioridade: medical_report > entidade patient) ──
    const pd = reportData.patientData ?? {};
    const patient = request.patient;

    // ── Procedimentos (TUSS) ────────────────────────────────────────────────
    const procedures = (request.tuss_items ?? []).map((item: any) => ({
      name: item.name || item.description || '',
      tussCode: item.tuss_code || item.tussCode || '',
      quantity: item.quantity ?? 1,
    }));

    // ── Materiais (OPME) ────────────────────────────────────────────────────
    const opmeItems = (request.opme_items ?? []).map((item: any) => ({
      name: item.name || '',
      quantity: item.quantity ?? 1,
    }));

    // ── Fabricantes e Fornecedores ──────────────────────────────────────────
    const unique = <T>(arr: T[]): T[] => [...new Set(arr)];
    const fabricantesText =
      unique(
        (request.opme_items ?? []).map((i: any) => i.brand).filter(Boolean),
      ).join(', ') || undefined;
    const fornecedoresText =
      unique(
        (request.opme_items ?? [])
          .map((i: any) => i.distributor)
          .filter(Boolean),
      ).join(', ') || undefined;

    // ── Hospital (Local) ────────────────────────────────────────────────────
    const hospitalName = request.hospital?.name || '';
    const hospitalAddress = request.hospital?.address || '';
    const localText =
      [hospitalName, hospitalAddress].filter(Boolean).join(' – ') || undefined;

    const crmText = profile?.crm
      ? `CRM ${profile.crm}${profile.crm_state ? '/' + profile.crm_state : ''}`
      : undefined;

    // ── Helpers de formatação ──────────────────────────────────────────
    const formatCpf = (v?: string) => {
      if (!v) return undefined;
      const d = v.replace(/\D/g, '');
      if (d.length !== 11) return v;
      return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    };
    const formatPhone = (v?: string) => {
      if (!v) return undefined;
      const d = v.replace(/\D/g, '');
      if (d.length === 11)
        return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
      if (d.length === 10)
        return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
      return v;
    };

    const pdfData: SurgeryRequestLaudoPdfData = {
      today: new Date().toLocaleDateString('pt-BR'),
      patientName: pd.name || patient?.name || undefined,
      patientBirthDate:
        pd.birthDate ||
        (patient?.birth_date
          ? new Date(patient.birth_date).toLocaleDateString('pt-BR')
          : undefined),
      patientRg: pd.rg || undefined,
      patientCpf: formatCpf(pd.cpf || patient?.cpf || undefined),
      patientPhone: formatPhone(pd.phone || patient?.phone || undefined),
      patientAddress: pd.address || patient?.address || undefined,
      patientZipCode: pd.zipCode || patient?.zip_code || undefined,
      patientHealthPlan:
        pd.healthPlan || request.health_plan?.name || undefined,
      sections: reportSections.length
        ? reportSections.map((s) => ({
            title: s.title,
            description: s.description,
          }))
        : undefined,
      historyAndDiagnosis: reportSections.length
        ? undefined
        : reportData.historyAndDiagnosis || undefined,
      conduct: reportSections.length
        ? undefined
        : reportData.conduct || undefined,
      examImages: examImages.length ? examImages : undefined,
      procedures: procedures.length ? procedures : undefined,
      opmeItems: opmeItems.length ? opmeItems : undefined,
      fabricantesText,
      fornecedoresText,
      hasSeparator: !!(fabricantesText || fornecedoresText || localText),
      localText,
      doctorName: doctor?.name ?? 'Médico',
      doctorEmail: doctor?.email || undefined,
      doctorPhone: formatPhone(doctor?.phone) || undefined,
      doctorCrm: crmText,
      doctorSpecialty: profile?.specialty || undefined,
      hasDoctorContact: !!(doctor?.email || doctor?.phone),
      hasDoctorInfo: !!(profile?.specialty || crmText),
      doctorSignatureUrl,
    };

    return this.pdfService.generateSurgeryRequestLaudoPdf(pdfData);
  }
}
