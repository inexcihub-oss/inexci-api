import { Injectable, Logger } from '@nestjs/common';

import {
  PdfService,
  MedicalReportPdfData,
  SurgeryRequestLaudoPdfData,
  ContestAuthorizationPdfData,
} from 'src/shared/pdf/pdf.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { SurgeryRequestTussItemRepository } from 'src/database/repositories/surgery-request-tuss-item.repository';
import { StorageService } from 'src/shared/storage/storage.service';
import {
  DoctorPdfContext,
  DoctorPdfContextService,
} from 'src/shared/pdf/doctor-pdf-context.service';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { Document } from 'src/database/entities/document.entity';
import { OpmeItem } from 'src/database/entities/opme-item.entity';
import { ContestationTypeEnum } from 'src/database/entities/contestation.entity';
import { formatPhone, todayBR } from 'src/shared/utils';
import {
  buildLaudoPatientFields,
  type LaudoPatientFields,
} from '../utils/laudo-patient-fields.util';
import {
  DOCUMENT_KEYS,
  PDF_EXCLUDED_DOCUMENT_KEYS,
} from 'src/shared/constants/document-keys';
import { SendMethod } from 'src/shared/constants/send-method';

function extractOpmeManufacturerNames(item: {
  manufacturers?: Array<{ name?: string | null }>;
}): string[] {
  return (item.manufacturers ?? [])
    .map((manufacturer) => manufacturer?.name?.trim())
    .filter((name): name is string => Boolean(name));
}

function extractSupplierNames(item: Pick<OpmeItem, 'suppliers'>): string[] {
  return (item.suppliers ?? [])
    .map((supplier) => supplier?.name)
    .filter((name): name is string => Boolean(name));
}

function uniqueNormalized(values: string[]): string[] {
  return Array.from(
    new Map(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map((value) => [value.toLowerCase(), value] as const),
    ).values(),
  );
}

interface ReportPdfContext {
  doctorContext: DoctorPdfContext;
  patientFields: LaudoPatientFields;
  sections?: Array<{ title: string; description: string }>;
  examImages?: string[];
}

type AssignedDoctorSource = {
  doctorId?: string;
  doctor?: SurgeryRequest['doctor'] | null;
};

@Injectable()
export class SurgeryRequestPdfAssemblyService {
  private readonly logger = new Logger(SurgeryRequestPdfAssemblyService.name);

  constructor(
    private readonly pdfService: PdfService,
    private readonly userRepository: UserRepository,
    private readonly tussItemRepository: SurgeryRequestTussItemRepository,
    private readonly storageService: StorageService,
    private readonly doctorPdfContextService: DoctorPdfContextService,
  ) {}

  async loadAssignedDoctorData(
    request: AssignedDoctorSource,
  ): Promise<DoctorPdfContext> {
    const doctorId = request.doctorId ?? request.doctor?.id;
    if (!doctorId) {
      throw new Error('Solicitação sem médico atribuído para geração de PDF');
    }

    const preloadedDoctor =
      request.doctor?.id === doctorId ? request.doctor : undefined;
    const doctor =
      preloadedDoctor ??
      (await this.userRepository.findOneWithProfile({ id: doctorId }));

    if (!doctor) {
      throw new Error(`Médico atribuído não encontrado: ${doctorId}`);
    }

    return this.doctorPdfContextService.buildForDoctor(doctor);
  }

  private async buildReportContext(
    request: SurgeryRequest,
  ): Promise<ReportPdfContext> {
    const doctorContext = await this.loadAssignedDoctorData(request);

    const examDocs = (request.documents ?? []).filter(
      (doc) => doc.key === DOCUMENT_KEYS.REPORT_IMAGES,
    );
    const examImages = (
      await Promise.all(examDocs.map((doc) => this.resolveImageUrl(doc)))
    ).filter((url): url is string => !!url);

    const sections = [...(request.reportSections ?? [])]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((section) => ({
        title: section.title,
        description: section.description ?? '',
      }));

    return {
      doctorContext,
      patientFields: buildLaudoPatientFields(request),
      sections: sections.length ? sections : undefined,
      examImages: examImages.length ? examImages : undefined,
    };
  }

  private async resolveImageUrl(doc: Document): Promise<string | null> {
    const raw = doc.uri;
    if (!raw) return null;
    if (raw.startsWith('http')) return raw;
    try {
      return await this.storageService.getSignedUrl(raw);
    } catch (err) {
      this.logger.warn(
        `[pdf] Não foi possível assinar a imagem de exame "${raw}": ${(err as Error)?.message}`,
      );
      return null;
    }
  }

  async generateLaudoPdf(
    request: SurgeryRequest,
    _userId: string,
    options?: { includeInfoDocuments?: boolean },
  ): Promise<{ pdf: string; method: SendMethod.DOWNLOAD }> {
    const { doctorContext, patientFields, sections, examImages } =
      await this.buildReportContext(request);
    const { doctor, profile, doctorCrm, doctorSignatureUrl, customHeader } =
      doctorContext;

    const doctorEmail = doctor?.email ?? '';
    const doctorPhoneFormatted = formatPhone(doctor?.phone ?? '');

    const procedures = (request.tussItems ?? []).map((item) => ({
      name: item.name,
      tussCode: item.tussCode,
      quantity: item.quantity ?? 1,
    }));

    const opmeItemsRaw = request.opmeItems ?? [];
    const opmeItems = opmeItemsRaw.map((item) => ({
      name: item.name,
      quantity: item.quantity ?? 1,
      fabricantesText: uniqueNormalized(
        extractOpmeManufacturerNames(item),
      ).join(', '),
      fornecedoresText: uniqueNormalized(extractSupplierNames(item)).join(', '),
    }));

    const fabricantes = uniqueNormalized(
      opmeItemsRaw.flatMap((item) => extractOpmeManufacturerNames(item)),
    );
    const fornecedores = uniqueNormalized(
      opmeItemsRaw.flatMap((item) => extractSupplierNames(item)),
    );

    const hospital = request.hospital;
    const localText = [hospital?.name, hospital?.address]
      .filter(Boolean)
      .join(' – ');

    const laudoData: SurgeryRequestLaudoPdfData = {
      today: todayBR(),
      ...patientFields,
      sections,
      examImages,
      procedures: procedures.length ? procedures : undefined,
      opmeItems: opmeItems.length ? opmeItems : undefined,
      fabricantesText: fabricantes.join(', ') || undefined,
      fornecedoresText: fornecedores.join(', ') || undefined,
      hasSeparator: fabricantes.length > 0 || fornecedores.length > 0,
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
    const finalBuffer = includeInfoDocuments
      ? await this.appendInfoDocuments(summaryBuffer, request.documents ?? [])
      : summaryBuffer;

    return { pdf: finalBuffer.toString('base64'), method: SendMethod.DOWNLOAD };
  }

  private async appendInfoDocuments(
    summaryBuffer: Buffer,
    documents: Document[],
  ): Promise<Buffer> {
    const infoDocs = documents.filter(
      (doc) =>
        doc.uri &&
        String(doc.uri).startsWith('documents/') &&
        !PDF_EXCLUDED_DOCUMENT_KEYS.includes(doc.key),
    );

    const docBuffers: Buffer[] = [];
    for (const doc of infoDocs) {
      if (!doc.uri) continue;
      try {
        const signedUrl = await this.storageService.getSignedUrl(doc.uri);
        const buf = await this.pdfService.fetchBuffer(signedUrl);
        if (buf) docBuffers.push(buf);
      } catch (err) {
        this.logger.warn(
          `[generateLaudoPdf] Não foi possível buscar documento "${doc.uri}": ${(err as Error)?.message}`,
        );
      }
    }

    if (docBuffers.length === 0) return summaryBuffer;

    this.logger.log(
      `[generateLaudoPdf] Mesclando PDF com ${docBuffers.length} documento(s) anexo(s)`,
    );
    return this.pdfService.mergePdfs([summaryBuffer, ...docBuffers]);
  }

  async generateMedicalReportPdf(
    request: SurgeryRequest,
    _userId: string,
  ): Promise<Buffer> {
    const { doctorContext, patientFields, sections, examImages } =
      await this.buildReportContext(request);
    const { doctor, profile, doctorSignatureUrl, customHeader } = doctorContext;

    const medicalData: MedicalReportPdfData = {
      today: todayBR(),
      ...patientFields,
      sections,
      examImages,
      doctorName: doctor?.name ?? 'Médico',
      doctorSpecialty: profile?.specialty || undefined,
      doctorCrm: profile?.crm || undefined,
      doctorCrmState: profile?.crmState || undefined,
      doctorSignatureUrl: doctorSignatureUrl || undefined,
      customHeader: customHeader || undefined,
    };

    return this.pdfService.generateMedicalReportPdf(medicalData);
  }

  async generateContestAuthorizationPdf(
    request: SurgeryRequest,
    id: string,
    _userId: string,
  ): Promise<Buffer> {
    const contestations = request.contestations ?? [];
    const latestContestation = contestations
      .filter((c) => c.type === ContestationTypeEnum.AUTHORIZATION)
      .sort(
        (a, b) =>
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
        (activity) =>
          typeof activity?.content === 'string' &&
          activity.content.startsWith(messageActivityPrefix),
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .find((activity) => {
        if (!latestContestationTime) return true;
        return new Date(activity.createdAt).getTime() >= latestContestationTime;
      })
      ?.content?.replace(messageActivityPrefix, '')
      ?.trim();

    const tussItems = await this.tussItemRepository.findMany({
      surgeryRequestId: id,
    });

    const procedures = tussItems.map((item) => ({
      description: item.name,
      tussCode: item.tussCode,
      requestedQuantity: item.quantity,
      authorizedQuantity: item.authorizedQuantity ?? null,
    }));

    const unique = (values: string[]): string[] =>
      Array.from(new Set(values.filter(Boolean)));

    const opmeItems = (request.opmeItems ?? []).map((item) => {
      const selectedSupplierName =
        item.selectedSupplier?.name ||
        (item.selectedSupplierId
          ? (item.suppliers ?? []).find(
              (supplier) =>
                String(supplier?.id) === String(item.selectedSupplierId),
            )?.name
          : undefined);

      const fornecedores = unique(
        selectedSupplierName ? [selectedSupplierName] : [],
      );

      const fabricantes = unique(extractOpmeManufacturerNames(item));

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
      (doc) =>
        !!doc?.uri &&
        (latestContestation?.id
          ? doc.contestationId === latestContestation.id
          : false),
    );

    const imageAttachments: string[] = [];
    const pdfAttachmentBuffers: Buffer[] = [];

    for (const doc of contestationDocuments) {
      if (!doc.uri) continue;
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
      } catch (err) {
        this.logger.warn(
          `[generateContestAuthorizationPdf] Não foi possível processar anexo "${doc.uri}": ${(err as Error)?.message}`,
        );
      }
    }

    const { doctor, profile, doctorCrm, doctorSignatureUrl, customHeader } =
      await this.loadAssignedDoctorData(request);

    const patientFields = buildLaudoPatientFields(request);

    const pdfData: ContestAuthorizationPdfData = {
      today: todayBR(),
      reason,
      message,
      ...patientFields,
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
