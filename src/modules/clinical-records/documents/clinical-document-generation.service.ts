import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClinicalRecordRepository } from 'src/database/repositories/clinical-record.repository';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { HealthPlanRepository } from 'src/database/repositories/health-plan.repository';
import { DocumentRepository } from 'src/database/repositories/document.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { STORAGE_FOLDERS } from 'src/config/storage.config';
import {
  ClinicalDocumentPatientFields,
  ExamReferralPdfData,
  MedicalCertificatePdfData,
  PdfService,
  PrescriptionPdfData,
} from 'src/shared/pdf/pdf.service';
import { DoctorPdfContextService } from 'src/shared/pdf/doctor-pdf-context.service';
import { auditProntuarioAccess } from 'src/shared/logging/audit';
import { ClinicalRecord } from 'src/database/entities/clinical-record.entity';
import { Patient } from 'src/database/entities/patient.entity';
import DOCUMENT_TYPES from 'src/common/document-types.common';
import { formatCpf, formatDateBR, formatPhone } from 'src/shared/utils';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { CreateMedicalCertificateDto } from './dto/create-medical-certificate.dto';
import { CreateExamReferralDto } from './dto/create-exam-referral.dto';

/** Limite da coluna `documents.name`. */
const DOCUMENT_NAME_MAX_LENGTH = 75;

const digitsOnly = (value?: string | null): string =>
  value ? value.replace(/\D/g, '') : '';

/**
 * Documentos emitidos durante o atendimento — receita, atestado e
 * encaminhamento de exames.
 *
 * Não existe entidade própria: o PDF é gerado a partir do payload, gravado no
 * R2 e registrado como `Document` do paciente (e da ficha, quando houver). O
 * documento é um retrato do momento da emissão — corrigir significa emitir
 * outro, o que mantém a mesma regra de imutabilidade do prontuário.
 */
@Injectable()
export class ClinicalDocumentGenerationService {
  private readonly logger = new Logger(ClinicalDocumentGenerationService.name);

  constructor(
    private readonly clinicalRecordRepository: ClinicalRecordRepository,
    private readonly patientRepository: PatientRepository,
    private readonly healthPlanRepository: HealthPlanRepository,
    private readonly documentRepository: DocumentRepository,
    private readonly accessControlService: AccessControlService,
    private readonly storageService: StorageService,
    private readonly pdfService: PdfService,
    private readonly doctorPdfContextService: DoctorPdfContextService,
  ) {}

  /** Receituário. */
  async generatePrescription(
    recordId: string,
    data: CreatePrescriptionDto,
    userId: string,
  ) {
    const { record, pdfData } = await this.buildPrescription(
      recordId,
      data,
      userId,
    );
    const pdf = await this.pdfService.generatePrescriptionPdf(pdfData);
    return this.persist(
      record,
      pdf,
      DOCUMENT_TYPES.prescription,
      'Receita',
      userId,
    );
  }

  /** Atestado médico. */
  async generateMedicalCertificate(
    recordId: string,
    data: CreateMedicalCertificateDto,
    userId: string,
  ) {
    const { record, pdfData } = await this.buildMedicalCertificate(
      recordId,
      data,
      userId,
    );
    const pdf = await this.pdfService.generateMedicalCertificatePdf(pdfData);
    return this.persist(
      record,
      pdf,
      DOCUMENT_TYPES.medicalCertificate,
      'Atestado',
      userId,
    );
  }

  /** Encaminhamento/solicitação de exames. */
  async generateExamReferral(
    recordId: string,
    data: CreateExamReferralDto,
    userId: string,
  ) {
    const { record, pdfData } = await this.buildExamReferral(
      recordId,
      data,
      userId,
    );
    const pdf = await this.pdfService.generateExamReferralPdf(pdfData);
    return this.persist(
      record,
      pdf,
      DOCUMENT_TYPES.examReferral,
      'Solicitação de exames',
      userId,
    );
  }

  // ── Pré-visualização ─────────────────────────────────────────────────────
  // Mesmo template e mesmos dados da emissão, devolvidos como HTML: quem só
  // quer conferir na tela não precisa esperar o Puppeteer subir um Chromium
  // para produzir um PDF que será descartado. Emitir é que gera o arquivo.

  async previewPrescription(
    recordId: string,
    data: CreatePrescriptionDto,
    userId: string,
  ): Promise<string> {
    const { pdfData } = await this.buildPrescription(recordId, data, userId);
    return this.pdfService.renderClinicalDocumentHtml('prescription', pdfData);
  }

  async previewMedicalCertificate(
    recordId: string,
    data: CreateMedicalCertificateDto,
    userId: string,
  ): Promise<string> {
    const { pdfData } = await this.buildMedicalCertificate(
      recordId,
      data,
      userId,
    );
    return this.pdfService.renderClinicalDocumentHtml(
      'medical-certificate',
      pdfData,
    );
  }

  async previewExamReferral(
    recordId: string,
    data: CreateExamReferralDto,
    userId: string,
  ): Promise<string> {
    const { pdfData } = await this.buildExamReferral(recordId, data, userId);
    return this.pdfService.renderClinicalDocumentHtml('exam-referral', pdfData);
  }

  // ── Montagem dos PDFs (compartilhada por emitir e pré-visualizar) ─────────

  private async buildPrescription(
    recordId: string,
    data: CreatePrescriptionDto,
    userId: string,
  ) {
    const { record, base } = await this.buildBaseContext(recordId, userId);

    const pdfData: PrescriptionPdfData = {
      ...base,
      items: data.items,
      notes: data.notes,
    };

    return { record, pdfData };
  }

  private async buildMedicalCertificate(
    recordId: string,
    data: CreateMedicalCertificateDto,
    userId: string,
  ) {
    const { record, base } = await this.buildBaseContext(recordId, userId);

    // O CID expõe o diagnóstico a quem recebe o atestado (empregador, escola),
    // então nunca entra sozinho: ou o médico escolhe o CID no atestado, ou
    // marca explicitamente para reaproveitar o da ficha.
    const cid =
      data.cid ?? (data.includeCid ? (record.cidCodes?.[0] ?? null) : null);

    const pdfData: MedicalCertificatePdfData = {
      ...base,
      restDaysLabel: this.buildRestDaysLabel(data.restDays),
      startDate: data.startDate ? formatDateBR(data.startDate) : undefined,
      cid,
      observations: data.observations,
    };

    return { record, pdfData };
  }

  private async buildExamReferral(
    recordId: string,
    data: CreateExamReferralDto,
    userId: string,
  ) {
    const { record, base } = await this.buildBaseContext(recordId, userId);

    const pdfData: ExamReferralPdfData = {
      ...base,
      exams: data.exams,
      clinicalIndication: data.clinicalIndication,
      // Por padrão o pedido carrega a hipótese diagnóstica já registrada na
      // ficha — é o que o convênio exige para autorizar o exame.
      cidCodes: data.cidCodes ?? record.cidCodes ?? undefined,
    };

    return { record, pdfData };
  }

  /**
   * Carrega ficha, paciente e médico e monta o bloco comum aos três PDFs.
   *
   * São três verificações, e nenhuma cobre a outra: quem emite precisa ser
   * médico (ato privativo), pertencer à clínica e ter vínculo com o médico da
   * ficha. O documento sai assinado com o nome, o CRM e a imagem de assinatura
   * desse médico — sem isso, um assistente emitiria receita em nome dele.
   *
   * Vale também para a prévia: é o mesmo documento, só que na tela.
   */
  private async buildBaseContext(recordId: string, userId: string) {
    await this.accessControlService.assertIsDoctor(userId);

    const record = await this.clinicalRecordRepository.findOne({
      id: recordId,
    });
    if (!record) throw new NotFoundException('Atendimento não encontrado');
    await this.accessControlService.assertCanAccessDoctorResource(
      userId,
      record.ownerId,
      record.doctorId,
    );

    const patient = await this.patientRepository.findOne({
      id: record.patientId,
    });
    if (!patient) throw new NotFoundException('Paciente não encontrado');

    const { doctor, profile, doctorCrm, doctorSignatureUrl, customHeader } =
      await this.doctorPdfContextService.buildForDoctorId(record.doctorId);

    const base = {
      today: formatDateBR(new Date().toISOString()),
      ...(await this.buildPatientFields(patient)),
      doctorName: doctor?.name ?? 'Médico',
      doctorCrm,
      doctorSpecialty: profile?.specialty || undefined,
      doctorSignatureUrl,
      customHeader,
    };

    return { record, patient, base };
  }

  private async buildPatientFields(
    patient: Patient,
  ): Promise<ClinicalDocumentPatientFields> {
    const healthPlan = patient.healthPlanId
      ? await this.healthPlanRepository.findOne({ id: patient.healthPlanId })
      : null;

    const cpf = digitsOnly(patient.cpf);
    const phone = digitsOnly(patient.phone);

    return {
      patientName: patient.name,
      patientBirthDate: patient.birthDate
        ? formatDateBR(String(patient.birthDate))
        : undefined,
      patientCpf: cpf.length === 11 ? formatCpf(cpf) : undefined,
      patientPhone: phone.length >= 10 ? formatPhone(phone) : undefined,
      patientAddress: this.formatAddress(patient),
      patientHealthPlan: healthPlan?.name || undefined,
      patientHealthPlanNumber: patient.healthPlanNumber || undefined,
    };
  }

  private formatAddress(patient: Patient): string | undefined {
    const parts = [
      patient.address,
      patient.addressNumber,
      patient.addressComplement,
      patient.neighborhood,
      patient.city,
      patient.state,
    ]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part));

    return parts.length ? parts.join(', ') : undefined;
  }

  private buildRestDaysLabel(restDays?: number): string | undefined {
    if (!restDays || restDays < 1) return undefined;
    return `${restDays} ${restDays === 1 ? 'dia' : 'dias'}`;
  }

  /** Sobe o PDF no R2 e registra o `Document` do paciente. */
  private async persist(
    record: ClinicalRecord,
    pdf: Buffer,
    type: string,
    label: string,
    userId: string,
  ) {
    const today = formatDateBR(new Date().toISOString());
    const filename = `${type}-${record.id}-${Date.now()}.pdf`;

    const storagePath = await this.storageService.create(
      {
        originalname: filename,
        mimetype: 'application/pdf',
        buffer: pdf,
      } as any,
      STORAGE_FOLDERS.DOCUMENTS,
      record.ownerId,
    );

    const document = await this.documentRepository.create({
      patientId: record.patientId,
      clinicalRecordId: record.id,
      createdById: userId,
      type,
      key: type,
      name: `${label} — ${today}`.slice(0, DOCUMENT_NAME_MAX_LENGTH),
      uri: storagePath,
    });

    auditProntuarioAccess({
      resource: 'clinical_record',
      resourceId: record.id,
      action: 'create',
      actorUserId: userId,
      tenantId: record.ownerId,
    });

    this.logger.log(
      `[CLINICAL_DOC] ${type} emitido para a ficha ${record.id} por ${userId}`,
    );

    return {
      ...document,
      path: storagePath,
      uri: await this.storageService.getSignedUrl(storagePath),
    };
  }
}
