import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
import { CidCodeDto } from '../dto/cid-code.dto';
import { ClinicalDocumentTemplateKind } from 'src/database/entities/clinical-document-template.entity';
import {
  aplicarPlaceholders,
  PlaceholderValues,
} from 'src/shared/pdf/placeholders.util';
import { limparTextoDoModelo } from 'src/shared/pdf/texto-do-modelo.util';
import { ClinicalDocumentTemplatesService } from '../document-templates/clinical-document-templates.service';
import { ApplyClinicalDocumentTemplateDto } from '../document-templates/dto/apply-clinical-document-template.dto';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { CreateMedicalCertificateDto } from './dto/create-medical-certificate.dto';
import { CreateExamReferralDto } from './dto/create-exam-referral.dto';
import {
  PreviewExamReferralDto,
  PreviewMedicalCertificateDto,
  PreviewPrescriptionDto,
} from './dto/preview-clinical-document.dto';

/** Limite da coluna `documents.name`. */
const DOCUMENT_NAME_MAX_LENGTH = 75;

const digitsOnly = (value?: string | null): string =>
  value ? value.replace(/\D/g, '') : '';

/**
 * Origem dos dados do documento.
 *
 * Emitir sempre parte de uma ficha gravada (`clinicalRecordId`). Pré-visualizar
 * pode partir do paciente + campos em memória: conferir um documento não pode
 * criar prontuário. Ver `PreviewTargetDto`.
 */
interface DocumentSource {
  clinicalRecordId?: string;
  patientId?: string;
  doctorId?: string;
  /** CIDs da ficha em memória, quando não há ficha gravada. */
  cidCodes?: CidCodeDto[] | null;
}

/** Extrai o alvo de um payload de prévia. */
const previewSource = (data: {
  clinicalRecordId?: string;
  patientId?: string;
  doctorId?: string;
  cidCodes?: CidCodeDto[];
}): DocumentSource => ({
  clinicalRecordId: data.clinicalRecordId,
  patientId: data.patientId,
  doctorId: data.doctorId,
  cidCodes: data.cidCodes,
});

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
    private readonly documentTemplatesService: ClinicalDocumentTemplatesService,
  ) {}

  /** Receituário. */
  async generatePrescription(
    recordId: string,
    data: CreatePrescriptionDto,
    userId: string,
  ) {
    const { record, pdfData } = await this.buildPrescription(
      { clinicalRecordId: recordId },
      data,
      userId,
    );
    const pdf = await this.pdfService.generatePrescriptionPdf(pdfData);
    return this.persist(
      this.assertRecord(record),
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
      { clinicalRecordId: recordId },
      data,
      userId,
    );
    const pdf = await this.pdfService.generateMedicalCertificatePdf(pdfData);
    return this.persist(
      this.assertRecord(record),
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
      { clinicalRecordId: recordId },
      data,
      userId,
    );
    const pdf = await this.pdfService.generateExamReferralPdf(pdfData);
    return this.persist(
      this.assertRecord(record),
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
  //
  // A prévia também não exige ficha gravada — ver `PreviewTargetDto`.

  async previewPrescription(
    data: PreviewPrescriptionDto,
    userId: string,
  ): Promise<string> {
    const { pdfData } = await this.buildPrescription(
      previewSource(data),
      data,
      userId,
    );
    return this.pdfService.renderClinicalDocumentHtml('prescription', pdfData);
  }

  async previewMedicalCertificate(
    data: PreviewMedicalCertificateDto,
    userId: string,
  ): Promise<string> {
    const { pdfData } = await this.buildMedicalCertificate(
      previewSource(data),
      data,
      userId,
    );
    return this.pdfService.renderClinicalDocumentHtml(
      'medical-certificate',
      pdfData,
    );
  }

  async previewExamReferral(
    data: PreviewExamReferralDto,
    userId: string,
  ): Promise<string> {
    const { pdfData } = await this.buildExamReferral(
      previewSource(data),
      data,
      userId,
    );
    return this.pdfService.renderClinicalDocumentHtml('exam-referral', pdfData);
  }

  // ── Modelos de texto (MIG-06) ─────────────────────────────────────────────

  /**
   * Texto do modelo já com os placeholders do paciente e do médico que
   * assina — o mesmo contexto que vai para o PDF, para o texto aplicado e o
   * documento emitido não divergirem. Aplicar é o que conta o uso.
   *
   * Exige o mesmo que emitir (médico com CRM e acesso ao paciente e ao médico
   * que assina): o texto devolvido já traz nome e CPF do paciente.
   */
  async applyTemplate(
    id: string,
    data: ApplyClinicalDocumentTemplateDto,
    userId: string,
  ): Promise<{ id: string; kind: ClinicalDocumentTemplateKind; body: string }> {
    const { base } = await this.buildBaseContext(previewSource(data), userId);
    const template = await this.documentTemplatesService.getForUse(
      id,
      null,
      userId,
    );
    await this.documentTemplatesService.incrementUsage(id);
    return {
      id: template.id,
      kind: template.kind,
      body: this.textoPronto(template.body, base, data.restDays),
    };
  }

  private async textoDoModelo(
    templateId: string | undefined,
    kind: ClinicalDocumentTemplateKind,
    base: Awaited<
      ReturnType<ClinicalDocumentGenerationService['buildBaseContext']>
    >['base'],
    restDays: number | undefined,
    userId: string,
  ): Promise<string | undefined> {
    if (!templateId) return undefined;
    const template = await this.documentTemplatesService.getForUse(
      templateId,
      kind,
      userId,
    );
    return this.textoPronto(template.body, base, restDays);
  }

  /**
   * Placeholders preenchidos e sem o título/assinatura que o PDF já imprime —
   * o modelo costuma ser escrito como o documento inteiro.
   */
  private textoPronto(
    body: string,
    base: Awaited<
      ReturnType<ClinicalDocumentGenerationService['buildBaseContext']>
    >['base'],
    restDays: number | undefined,
  ): string {
    return limparTextoDoModelo(
      aplicarPlaceholders(body, this.placeholderValues(base, restDays)),
      { nome: base.doctorName, registro: base.doctorCrm },
    );
  }

  private placeholderValues(
    base: {
      patientName?: string;
      patientCpf?: string;
      patientBirthDate?: string;
      doctorName: string;
      doctorCrm?: string | null;
      today: string;
    },
    restDays?: number,
  ): PlaceholderValues {
    return {
      'paciente.nome': base.patientName,
      'paciente.cpf': base.patientCpf,
      'paciente.nascimento': base.patientBirthDate,
      'medico.nome': base.doctorName,
      'medico.registro': base.doctorCrm,
      data: base.today,
      dias: restDays,
    };
  }

  // ── Montagem dos PDFs (compartilhada por emitir e pré-visualizar) ─────────

  private async buildPrescription(
    source: DocumentSource,
    data: CreatePrescriptionDto | PreviewPrescriptionDto,
    userId: string,
  ) {
    const { record, base } = await this.buildBaseContext(source, userId);

    const pdfData: PrescriptionPdfData = {
      ...base,
      items: data.items,
      notes: data.notes,
    };

    return { record, pdfData };
  }

  private async buildMedicalCertificate(
    source: DocumentSource,
    data: CreateMedicalCertificateDto | PreviewMedicalCertificateDto,
    userId: string,
  ) {
    const { record, base, cidCodes } = await this.buildBaseContext(
      source,
      userId,
    );

    // O CID expõe o diagnóstico a quem recebe o atestado (empregador, escola),
    // então nunca entra sozinho: ou o médico escolhe o CID no atestado, ou
    // marca explicitamente para reaproveitar o da ficha.
    const cid = data.cid ?? (data.includeCid ? (cidCodes?.[0] ?? null) : null);

    const pdfData: MedicalCertificatePdfData = {
      ...base,
      restDaysLabel: this.buildRestDaysLabel(data.restDays),
      startDate: data.startDate ? formatDateBR(data.startDate) : undefined,
      cid,
      // O modelo é o texto do atestado: substitui a declaração padrão. Antes
      // ia para as observações e o atestado saía com o texto duas vezes.
      text:
        data.text ??
        (await this.textoDoModelo(
          data.templateId,
          ClinicalDocumentTemplateKind.MEDICAL_CERTIFICATE,
          base,
          data.restDays,
          userId,
        )),
      observations: data.observations,
    };

    return { record, pdfData };
  }

  private async buildExamReferral(
    source: DocumentSource,
    data: CreateExamReferralDto | PreviewExamReferralDto,
    userId: string,
  ) {
    const { record, base, cidCodes } = await this.buildBaseContext(
      source,
      userId,
    );

    const pdfData: ExamReferralPdfData = {
      ...base,
      exams: data.exams,
      clinicalIndication:
        data.clinicalIndication ??
        (await this.textoDoModelo(
          data.templateId,
          ClinicalDocumentTemplateKind.EXAM_REFERRAL,
          base,
          undefined,
          userId,
        )),
      // Por padrão o pedido carrega a hipótese diagnóstica já registrada na
      // ficha — é o que o convênio exige para autorizar o exame.
      cidCodes: data.cidCodes ?? cidCodes ?? undefined,
    };

    return { record, pdfData };
  }

  /**
   * Carrega ficha (quando houver), paciente e médico e monta o bloco comum aos
   * três PDFs.
   *
   * São três verificações, e nenhuma cobre a outra: quem emite precisa ser
   * médico (ato privativo), pertencer à clínica e ter vínculo com o médico do
   * documento. O documento sai assinado com o nome, o CRM e a imagem de
   * assinatura desse médico — sem isso, um assistente emitiria receita em nome
   * dele.
   *
   * Vale também para a prévia: é o mesmo documento, só que na tela.
   */
  private async buildBaseContext(source: DocumentSource, userId: string) {
    // Receita, atestado e pedido de exame são atos de médico (CRM): quem
    // emite tem que ser médico, e o documento também tem que sair em nome de
    // um — o `doctorId` da ficha pode ser outro profissional da conta.
    await this.accessControlService.assertIsPhysician(userId);

    const { record, patient, doctorId, cidCodes } = await this.resolveSubject(
      source,
      userId,
    );
    if (doctorId !== userId) {
      await this.accessControlService.assertIsPhysician(
        doctorId,
        'Este documento só pode ser emitido em nome de um médico (CRM).',
      );
    }

    const { doctor, profile, doctorCrm, doctorSignatureUrl, customHeader } =
      await this.doctorPdfContextService.buildForDoctorId(doctorId);

    // CRM sem número sai do importador (profissional sem conselho no Feegow
    // e especialidade médica). Documento com o registro em branco não vale —
    // recusa até alguém preencher o número na tela de colaboradores.
    if (!profile?.crm?.trim()) {
      throw new BadRequestException(
        `Preencha o número do CRM de ${doctor?.name ?? 'quem assina'} em Colaboradores antes de emitir documentos.`,
      );
    }

    const base = {
      today: formatDateBR(new Date().toISOString()),
      ...(await this.buildPatientFields(patient)),
      doctorName: doctor?.name ?? 'Médico',
      doctorCrm,
      doctorSpecialty: profile?.specialty || undefined,
      doctorSignatureUrl,
      customHeader,
    };

    return { record, patient, cidCodes, base };
  }

  /**
   * Resolve paciente, médico e CIDs a partir da ficha gravada ou, na prévia sem
   * ficha, do próprio payload. O recorte de acesso é o mesmo nos dois caminhos:
   * clínica (`ownerId`) + vínculo com o médico que assina.
   */
  private async resolveSubject(
    source: DocumentSource,
    userId: string,
  ): Promise<{
    record: ClinicalRecord | null;
    patient: Patient;
    doctorId: string;
    cidCodes: CidCodeDto[] | null;
  }> {
    if (source.clinicalRecordId) {
      const record = await this.clinicalRecordRepository.findOne({
        id: source.clinicalRecordId,
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

      return {
        record,
        patient,
        doctorId: record.doctorId,
        cidCodes: record.cidCodes ?? null,
      };
    }

    if (!source.patientId) {
      throw new BadRequestException(
        'Informe a ficha de atendimento ou o paciente do documento.',
      );
    }

    const patient = await this.patientRepository.findOne({
      id: source.patientId,
    });
    if (!patient) throw new NotFoundException('Paciente não encontrado');

    // Sem ficha não há médico gravado: assina quem está pré-visualizando, a
    // menos que o payload aponte outro — e aí o vínculo é conferido igual.
    const doctorId = source.doctorId ?? userId;
    await this.accessControlService.assertCanAccessDoctorResource(
      userId,
      patient.ownerId,
      doctorId,
    );

    return {
      record: null,
      patient,
      doctorId,
      cidCodes: source.cidCodes ?? null,
    };
  }

  /** Emitir grava um `Document` da ficha — só a prévia dispensa a ficha. */
  private assertRecord(record: ClinicalRecord | null): ClinicalRecord {
    if (!record) throw new NotFoundException('Atendimento não encontrado');
    return record;
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
