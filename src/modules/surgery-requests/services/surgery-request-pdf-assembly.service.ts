import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  PdfService,
  MedicalReportPdfData,
  SurgeryRequestLaudoPdfData,
  ContestAuthorizationPdfData,
  CustomHeaderData,
} from 'src/shared/pdf/pdf.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { StorageService } from 'src/shared/storage/storage.service';
import { DoctorHeaderRepository } from 'src/database/repositories/doctor-header.repository';
import { SurgeryRequestTussItem } from 'src/database/entities/surgery-request-tuss-item.entity';
import {
  formatPhone,
  formatCpf,
  formatCep,
  formatDateBR,
} from 'src/shared/utils';
import { DOCUMENT_KEYS } from 'src/shared/constants/document-keys';
import { SendMethod } from 'src/shared/constants/send-method';

@Injectable()
export class SurgeryRequestPdfAssemblyService {
  private readonly logger = new Logger(SurgeryRequestPdfAssemblyService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly pdfService: PdfService,
    private readonly userRepository: UserRepository,
    private readonly storageService: StorageService,
    private readonly doctorHeaderRepository: DoctorHeaderRepository,
  ) {}

  /**
   * Resolve a URL da assinatura do médico (signed URL se for path do storage).
   */
  async resolveDoctorSignatureUrl(profile: any): Promise<string | undefined> {
    if (!profile?.signatureUrl) return undefined;
    const raw: string = profile.signatureUrl;
    if (raw.startsWith('http')) return raw;
    try {
      return await this.storageService.getSignedUrl(raw);
    } catch {
      return undefined;
    }
  }

  /**
   * Carrega dados do médico (profile, CRM, assinatura, cabeçalho) necessários para PDFs.
   */
  async loadDoctorData(userId: string) {
    const doctor = await this.userRepository.findOneWithProfile({ id: userId });
    const profile = doctor?.doctorProfile;

    let doctorCrm: string | undefined;
    if (profile?.crm) {
      doctorCrm = `CRM ${profile.crm}${profile.crmState ? `/${profile.crmState}` : ''}`;
    }

    const doctorSignatureUrl = await this.resolveDoctorSignatureUrl(profile);

    let customHeader: CustomHeaderData | null = null;
    if (profile?.id) {
      const header = await this.doctorHeaderRepository.findByDoctorProfileId(
        profile.id,
      );
      if (header) {
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
        customHeader = {
          logoUrl,
          logoPosition: header.logoPosition,
          contentHtml: header.contentHtml,
        };
      }
    }

    return { doctor, profile, doctorCrm, doctorSignatureUrl, customHeader };
  }

  /**
   * Gera o PDF do laudo (resumo da solicitação).
   *
   * Por padrão, mescla também os documentos da aba "Informações Gerais"
   * (pasta `documents/`) ao final do PDF.
   */
  async generateLaudoPdf(
    request: any,
    userId: string,
    options?: { includeInfoDocuments?: boolean },
  ): Promise<{ pdf: string; method: SendMethod.DOWNLOAD }> {
    const { doctor, profile, doctorCrm, doctorSignatureUrl, customHeader } =
      await this.loadDoctorData(userId);

    const doctorEmail = doctor?.email ?? '';
    const doctorPhoneRaw = doctor?.phone ?? '';
    const doctorPhoneFormatted = formatPhone(doctorPhoneRaw);

    // ── Dados do laudo (medicalReport JSON) ───────────────────────────────
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
      if (request.medicalReport) {
        reportData = JSON.parse(request.medicalReport as unknown as string);
      }
    } catch {
      // fallback vazio
    }

    const pd = reportData.patientData ?? {};
    const patient = request.patient;

    // ── Imagens dos exames ─────────────────────────────────────────────────
    const allDocs = request.documents ?? [];
    const examDocs = allDocs.filter(
      (d: any) => d.key === DOCUMENT_KEYS.REPORT_IMAGES,
    );
    const examImages: string[] = (
      await Promise.all(
        examDocs.map(async (doc: any) => {
          const raw: string = doc.uri;
          if (!raw) return null;
          if (raw.startsWith('http')) return raw;
          try {
            return await this.storageService.getSignedUrl(raw);
          } catch {
            return null;
          }
        }),
      )
    ).filter((u): u is string => !!u);

    // ── Procedimentos (TUSS) ─────────────────────────────────────────────
    const tussItems = request.tussItems ?? [];
    const procedures = tussItems.map((item: any) => ({
      name: item.name,
      tussCode: item.tussCode,
      quantity: item.quantity ?? 1,
    }));

    // ── Materiais (OPME) ─────────────────────────────────────────────────
    const opmeItemsRaw = request.opmeItems ?? [];

    const extractNames = (value: unknown): string[] => {
      if (typeof value !== 'string') return [];
      return value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    };

    const uniqueNormalized = (arr: string[]) =>
      Array.from(
        new Map(
          arr
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
            .map((value) => [value.toLowerCase(), value] as const),
        ).values(),
      );

    const opmeItems = opmeItemsRaw.map((item: any) => ({
      name: item.name,
      quantity: item.quantity ?? 1,
      fabricantesText: uniqueNormalized([
        ...((item.manufacturers ?? [])
          .map((m: any) => m?.name)
          .filter(Boolean) as string[]),
        ...extractNames(item.brand),
      ]).join(', '),
      fornecedoresText: uniqueNormalized(
        (item.suppliers ?? []).map((s: any) => s?.name).filter(Boolean),
      ).join(', '),
    }));

    // ── Fabricantes e Fornecedores ───────────────────────────────────────
    const fabricantes = uniqueNormalized(
      opmeItemsRaw.flatMap((i: any) => [
        ...((i.manufacturers ?? [])
          .map((m: any) => m?.name)
          .filter(Boolean) as string[]),
        ...extractNames(i.brand),
      ]),
    );
    const fornecedores = uniqueNormalized(
      opmeItemsRaw.flatMap((i: any) => [
        ...extractNames(i.distributor),
        ...((i.suppliers ?? [])
          .map((s: any) => s?.name)
          .filter(Boolean) as string[]),
      ]),
    );
    const fabricantesText =
      fabricantes.length > 0 ? fabricantes.join(', ') : '';
    const fornecedoresText =
      fornecedores.length > 0 ? fornecedores.join(', ') : '';
    const hasSeparator = fabricantes.length > 0 || fornecedores.length > 0;

    // ── Hospital (local) ────────────────────────────────────────────────
    const hospital = request.hospital;
    const localText = [hospital?.name, hospital?.address]
      .filter(Boolean)
      .join(' – ');

    // ── Seções dinâmicas do laudo ─────────────────────────────────────────
    const reportSections = ((request.reportSections ?? []) as any[]).sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );

    const laudoData: SurgeryRequestLaudoPdfData = {
      today: new Date().toLocaleDateString('pt-BR'),
      patientName: pd.name || patient?.name || undefined,
      patientBirthDate:
        pd.birthDate ||
        (patient?.birthDate ? formatDateBR(patient.birthDate) : undefined),
      patientRg: pd.rg || patient?.rg || undefined,
      patientCpf: formatCpf(pd.cpf || patient?.cpf || '') || undefined,
      patientPhone: formatPhone(pd.phone || patient?.phone || '') || undefined,
      patientAddress: pd.address || patient?.address || undefined,
      patientZipCode:
        formatCep(pd.zipCode || patient?.zipCode || patient?.cep || '') ||
        undefined,
      patientHealthPlan: pd.healthPlan || request.healthPlan?.name || undefined,
      historyAndDiagnosis: reportSections.length
        ? undefined
        : reportData.historyAndDiagnosis || undefined,
      conduct: reportSections.length
        ? undefined
        : reportData.conduct || undefined,
      sections: reportSections.length
        ? reportSections.map((s: any) => ({
            title: s.title,
            description: s.description,
          }))
        : undefined,
      examImages: examImages.length ? examImages : undefined,
      procedures: procedures.length ? procedures : undefined,
      opmeItems: opmeItems.length ? opmeItems : undefined,
      fabricantesText: fabricantesText || undefined,
      fornecedoresText: fornecedoresText || undefined,
      hasSeparator,
      localText: localText || undefined,
      doctorName: doctor?.name ?? 'Médico',
      doctorEmail: doctorEmail || undefined,
      doctorPhone: doctorPhoneFormatted || undefined,
      doctorSpecialty: profile?.specialty || undefined,
      doctorCrm: doctorCrm || undefined,
      hasDoctorContact: !!(doctorEmail || doctorPhoneFormatted),
      hasDoctorInfo: !!(doctor?.name || profile?.specialty || doctorCrm),
      doctorSignatureUrl: doctorSignatureUrl || undefined,
      customHeader: customHeader || undefined,
    };

    const summaryBuffer =
      await this.pdfService.generateSurgeryRequestLaudoPdf(laudoData);

    const includeInfoDocuments = options?.includeInfoDocuments ?? true;

    // ── Mesclar resumo + documentos em um único PDF (opcional) ──────────
    let finalBuffer = summaryBuffer;
    if (includeInfoDocuments) {
      // ── Buscar documentos da aba Informações Gerais (pasta documents/) ─
      const infoDocs = allDocs.filter(
        (d: any) =>
          d.uri &&
          String(d.uri).startsWith('documents/') &&
          d.key !== DOCUMENT_KEYS.REPORT_IMAGES,
      );

      const docBuffers: Buffer[] = [];
      for (const doc of infoDocs) {
        try {
          const signedUrl = await this.storageService.getSignedUrl(doc.uri);
          const buf = await this.pdfService.fetchBuffer(signedUrl);
          if (buf) docBuffers.push(buf);
        } catch (err: any) {
          this.logger.warn(
            `[generateLaudoPdf] Não foi possível buscar documento "${doc.uri}": ${err?.message}`,
          );
        }
      }

      if (docBuffers.length > 0) {
        this.logger.log(
          `[generateLaudoPdf] Mesclando PDF com ${docBuffers.length} documento(s) anexo(s)`,
        );
        finalBuffer = await this.pdfService.mergePdfs([
          summaryBuffer,
          ...docBuffers,
        ]);
      }
    }

    return { pdf: finalBuffer.toString('base64'), method: SendMethod.DOWNLOAD };
  }

  /**
   * Gera o PDF do laudo médico (template `medical-report`) exatamente como
   * a pré-visualização do Laudo Médico, sem blocos de solicitação cirúrgica.
   */
  async generateMedicalReportPdf(
    request: any,
    userId: string,
  ): Promise<Buffer> {
    const { doctor, profile, doctorSignatureUrl, customHeader } =
      await this.loadDoctorData(userId);

    // ── Dados do laudo (medicalReport JSON) ───────────────────────────────
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
      surgicalIndication?: string;
      conduct?: string;
      technicalJustification?: string;
    } = {};
    try {
      if (request.medicalReport) {
        reportData = JSON.parse(request.medicalReport as unknown as string);
      }
    } catch {
      // fallback vazio
    }

    const pd = reportData.patientData ?? {};
    const patient = request.patient;

    // ── Imagens dos exames ─────────────────────────────────────────────────
    const allDocs = request.documents ?? [];
    const examDocs = allDocs.filter(
      (d: any) => d.key === DOCUMENT_KEYS.REPORT_IMAGES,
    );
    const examImages: string[] = (
      await Promise.all(
        examDocs.map(async (doc: any) => {
          const raw: string = doc.uri;
          if (!raw) return null;
          if (raw.startsWith('http')) return raw;
          try {
            return await this.storageService.getSignedUrl(raw);
          } catch {
            return null;
          }
        }),
      )
    ).filter((u): u is string => !!u);

    // ── Seções dinâmicas do laudo ─────────────────────────────────────────
    const reportSections = ((request.reportSections ?? []) as any[]).sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );

    const medicalData: MedicalReportPdfData = {
      today: new Date().toLocaleDateString('pt-BR'),
      patientName: pd.name || patient?.name || undefined,
      patientBirthDate:
        pd.birthDate ||
        (patient?.birthDate ? formatDateBR(patient.birthDate) : undefined),
      patientRg: pd.rg || patient?.rg || undefined,
      patientCpf: formatCpf(pd.cpf || patient?.cpf || '') || undefined,
      patientPhone: formatPhone(pd.phone || patient?.phone || '') || undefined,
      patientAddress: pd.address || patient?.address || undefined,
      patientZipCode:
        formatCep(pd.zipCode || patient?.zipCode || patient?.cep || '') ||
        undefined,
      patientHealthPlan: pd.healthPlan || request.healthPlan?.name || undefined,
      sections: reportSections.length
        ? reportSections.map((s: any) => ({
            title: s.title,
            description: s.description,
          }))
        : undefined,
      historyAndDiagnosis: reportSections.length
        ? undefined
        : reportData.historyAndDiagnosis ||
          reportData.surgicalIndication ||
          undefined,
      conduct: reportSections.length
        ? undefined
        : reportData.conduct || reportData.technicalJustification || undefined,
      examImages: examImages.length ? examImages : undefined,
      doctorName: doctor?.name ?? 'Médico',
      doctorSpecialty: profile?.specialty || undefined,
      doctorCrm: profile?.crm || undefined,
      doctorCrmState: profile?.crmState || undefined,
      doctorSignatureUrl: doctorSignatureUrl || undefined,
      customHeader: customHeader || undefined,
    };

    return this.pdfService.generateMedicalReportPdf(medicalData);
  }

  /**
   * Gera o PDF de contestação de autorização.
   */
  async generateContestAuthorizationPdf(
    request: any,
    id: string,
    userId: string,
  ): Promise<Buffer> {
    const contestations = request.contestations ?? [];
    const latestContestation = contestations
      .filter((c: any) => c.type === 'authorization')
      .sort(
        (a: any, b: any) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];

    const reason =
      latestContestation?.reason ??
      'Venho por meio deste contestar a negativa de autorização referente aos códigos e materiais OPME solicitados.';

    const latestContestationTime = latestContestation?.createdAt
      ? new Date(latestContestation.createdAt).getTime()
      : 0;

    const messageActivityPrefix = 'Mensagem da contestação:';
    const message = (request.activities ?? [])
      .filter(
        (activity: any) =>
          typeof activity?.content === 'string' &&
          activity.content.startsWith(messageActivityPrefix),
      )
      .sort(
        (a: any, b: any) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .find((activity: any) => {
        if (!latestContestationTime) return true;
        return new Date(activity.createdAt).getTime() >= latestContestationTime;
      })
      ?.content?.replace(messageActivityPrefix, '')
      ?.trim();

    const patient = request.patient;

    const tussItems = await this.dataSource
      .getRepository(SurgeryRequestTussItem)
      .find({ where: { surgeryRequestId: id } });

    const procedures = tussItems.map((item) => ({
      description: item.name,
      tussCode: item.tussCode,
      requestedQuantity: item.quantity,
      authorizedQuantity: item.authorizedQuantity ?? null,
    }));

    const splitAndNormalize = (value?: string | null): string[] =>
      (value ?? '')
        .split(/[,;|\n]+/)
        .map((part) => part.trim())
        .filter(Boolean);

    const unique = (values: string[]): string[] =>
      Array.from(new Set(values.filter(Boolean)));

    const opmeItems = (request.opmeItems ?? []).map((item: any) => {
      const selectedSupplierName =
        item.selectedSupplier?.name ||
        (item.selectedSupplierId
          ? (item.suppliers ?? []).find(
              (supplier: any) =>
                String(supplier?.id) === String(item.selectedSupplierId),
            )?.name
          : undefined);

      const fornecedores = unique(
        selectedSupplierName ? [selectedSupplierName] : [],
      );

      const fabricantes = unique(splitAndNormalize(item.brand));

      return {
        name: item.name,
        requestedQuantity: item.quantity,
        authorizedQuantity:
          item.authorizedQuantity !== undefined
            ? item.authorizedQuantity
            : null,
        fabricantesText: fabricantes.join(', '),
        fornecedoresText: fornecedores.join(', '),
      };
    });

    const contestationDocuments = (request.documents ?? []).filter(
      (doc: any) =>
        !!doc?.uri &&
        (latestContestation?.id
          ? doc.contestationId === latestContestation.id
          : false),
    );

    const imageAttachments: string[] = [];
    const pdfAttachmentBuffers: Buffer[] = [];

    for (const doc of contestationDocuments) {
      try {
        const signedUrl = await this.storageService.getSignedUrl(doc.uri);
        const lowerName = String(doc.name ?? doc.uri).toLowerCase();

        if (lowerName.endsWith('.pdf')) {
          const buf = await this.pdfService.fetchBuffer(signedUrl);
          if (buf) pdfAttachmentBuffers.push(buf);
          continue;
        }

        if (
          lowerName.endsWith('.png') ||
          lowerName.endsWith('.jpg') ||
          lowerName.endsWith('.jpeg') ||
          lowerName.endsWith('.webp')
        ) {
          imageAttachments.push(signedUrl);
        }
      } catch (err: any) {
        this.logger.warn(
          `[generateContestAuthorizationPdf] Não foi possível processar anexo "${doc.uri}": ${err?.message}`,
        );
      }
    }

    const { doctor, profile, doctorCrm, doctorSignatureUrl, customHeader } =
      await this.loadDoctorData(userId);

    const pdfData: ContestAuthorizationPdfData = {
      today: new Date().toLocaleDateString('pt-BR'),
      reason,
      message,
      patientName: patient?.name ?? undefined,
      patientBirthDate: patient?.birthDate
        ? new Date(patient.birthDate).toLocaleDateString('pt-BR')
        : undefined,
      patientRg: patient?.rg ?? undefined,
      patientCpf: patient?.cpf ?? undefined,
      patientPhone: patient?.phone ?? undefined,
      patientAddress: patient?.address ?? undefined,
      patientZipCode: patient?.zipCode ?? patient?.cep ?? undefined,
      patientHealthPlan: request.healthPlan?.name ?? undefined,
      procedures: procedures.length ? procedures : undefined,
      opmeItems: opmeItems.length ? opmeItems : undefined,
      attachments: imageAttachments.length ? imageAttachments : undefined,
      doctorName: doctor?.name ?? 'Médico',
      doctorCrm,
      doctorSpecialty: profile?.specialty ?? undefined,
      doctorSignatureUrl,
      customHeader: customHeader || undefined,
    };

    const basePdf =
      await this.pdfService.generateContestAuthorizationPdf(pdfData);

    if (pdfAttachmentBuffers.length > 0) {
      return this.pdfService.mergePdfs([basePdf, ...pdfAttachmentBuffers]);
    }

    return basePdf;
  }
}
