import {
  BadRequestException,
  ForbiddenException,
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
import {
  formatCpf,
  formatDateBR,
  formatPhone,
  todayBR,
} from 'src/shared/utils';
import { CidCodeDto } from '../dto/cid-code.dto';
import { ClinicalDocumentTemplateKind } from 'src/database/entities/clinical-document-template.entity';
import {
  hasCouncilRegistry,
  ProfessionalCouncil,
} from 'src/database/entities/doctor-profile.entity';
import {
  aplicarPlaceholdersDetalhado,
  DocumentPlaceholder,
  PlaceholdersAplicados,
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

const DOCUMENT_NAME_MAX_LENGTH = 75;

const digitsOnly = (value?: string | null): string =>
  value ? value.replace(/\D/g, '') : '';

type BaseContext = Awaited<
  ReturnType<ClinicalDocumentGenerationService['buildBaseContext']>
>['base'];

const PREENCHIDOS_NA_EMISSAO = ['dias', 'inicio'] as const;

const tituloDoAtestado = (council?: string | null): string =>
  council === ProfessionalCouncil.CRO
    ? 'ATESTADO ODONTOLÓGICO'
    : 'ATESTADO MÉDICO';

export const MENSAGEM_SO_O_PROFISSIONAL_EMITE =
  'Só o profissional da consulta pode emitir este documento.';

export function montarNotaDeAfastamento(opcoes: {
  texto: string;
  textoTinhaDias: boolean;
  textoTinhaInicio: boolean;
  restDays: number | undefined;
  restDaysLabel: string | undefined;
  startDate: string | undefined;
}): string | undefined {
  const { texto, textoTinhaDias, textoTinhaInicio, restDays, restDaysLabel } =
    opcoes;
  if (!restDays || restDays < 1 || !restDaysLabel) return undefined;
  const startDate = opcoes.startDate;
  const faltaInicio =
    !!startDate && !textoTinhaInicio && !texto.includes(startDate);

  if (!textoTinhaDias) {
    return faltaInicio
      ? `Afastamento de ${restDaysLabel}, a partir de ${startDate}.`
      : `Afastamento de ${restDaysLabel}.`;
  }
  return faltaInicio ? `Início do afastamento: ${startDate}.` : undefined;
}

const PLACEHOLDERS_DE_AFASTAMENTO: readonly DocumentPlaceholder[] = [
  'dias',
  'inicio',
];

export function assertSemAfastamentoPendente(
  preenchido: PlaceholdersAplicados | undefined,
  documento: 'atestado' | 'pedido de exame',
): void {
  if (!preenchido) return;
  const pendentes = PLACEHOLDERS_DE_AFASTAMENTO.filter((chave) =>
    preenchido.semValor.has(chave),
  );
  if (!pendentes.length) return;
  const marcadores = pendentes.map((chave) => `{{${chave}}}`).join(' e ');
  throw new BadRequestException(
    documento === 'atestado'
      ? `O texto do atestado usa ${marcadores}, mas os dias de afastamento não foram informados. Informe os dias de afastamento ou remova ${marcadores} do texto.`
      : `O pedido de exame não tem afastamento: remova ${marcadores} do texto da indicação clínica.`,
  );
}

interface DocumentSource {
  clinicalRecordId?: string;
  patientId?: string;
  doctorId?: string;
  cidCodes?: CidCodeDto[] | null;
}

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

  async applyTemplate(
    id: string,
    data: ApplyClinicalDocumentTemplateDto,
    userId: string,
  ): Promise<{ id: string; kind: ClinicalDocumentTemplateKind; body: string }> {
    const { base, doctorId } = await this.buildBaseContext(
      previewSource(data),
      userId,
    );
    const template = await this.documentTemplatesService.getForUse(
      id,
      null,
      userId,
      doctorId,
    );
    if (!data.refresh) await this.documentTemplatesService.incrementUsage(id);
    return {
      id: template.id,
      kind: template.kind,
      body: this.preencherModelo(
        template.body,
        this.placeholderValues(base),
        base,
        PREENCHIDOS_NA_EMISSAO,
      ).texto,
    };
  }

  private async textoDoModelo(
    templateId: string | undefined,
    kind: ClinicalDocumentTemplateKind,
    base: BaseContext,
    valores: PlaceholderValues,
    signingDoctorId: string,
    userId: string,
  ): Promise<PlaceholdersAplicados | undefined> {
    if (!templateId) return undefined;
    const template = await this.documentTemplatesService.getForUse(
      templateId,
      kind,
      userId,
      signingDoctorId,
    );
    return this.preencherModelo(template.body, valores, base);
  }

  private preencherModelo(
    body: string,
    valores: PlaceholderValues,
    base: BaseContext,
    manterSemValor?: readonly DocumentPlaceholder[],
  ): PlaceholdersAplicados {
    const preenchido = aplicarPlaceholdersDetalhado(body, valores, {
      manterSemValor,
    });
    return {
      ...preenchido,
      texto: limparTextoDoModelo(preenchido.texto, {
        nome: base.doctorName,
        registro: base.doctorCrm,
      }),
    };
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
    inicio?: string,
  ): PlaceholderValues {
    return {
      'paciente.nome': base.patientName,
      'paciente.cpf': base.patientCpf,
      'paciente.nascimento': base.patientBirthDate,
      'medico.nome': base.doctorName,
      'medico.registro': base.doctorCrm,
      data: base.today,
      dias: restDays,
      inicio,
    };
  }

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
    const { record, base, cidCodes, doctorId, council } =
      await this.buildBaseContext(source, userId);

    const cid = data.cid ?? (data.includeCid ? (cidCodes?.[0] ?? null) : null);

    const restDaysLabel = this.buildRestDaysLabel(data.restDays);
    const startDate = data.startDate ? formatDateBR(data.startDate) : undefined;
    const valores = this.placeholderValues(
      base,
      data.restDays,
      startDate ?? (restDaysLabel ? base.today : undefined),
    );

    const preenchido =
      data.text !== undefined
        ? aplicarPlaceholdersDetalhado(data.text, valores)
        : await this.textoDoModelo(
            data.templateId,
            ClinicalDocumentTemplateKind.MEDICAL_CERTIFICATE,
            base,
            valores,
            doctorId,
            userId,
          );
    assertSemAfastamentoPendente(preenchido, 'atestado');
    const text = preenchido?.texto;

    const pdfData: MedicalCertificatePdfData = {
      ...base,
      certificateTitle: tituloDoAtestado(council),
      restDaysLabel,
      startDate,
      restPeriodNote:
        text && preenchido
          ? montarNotaDeAfastamento({
              texto: text,
              textoTinhaDias: preenchido.presentes.has('dias'),
              textoTinhaInicio: preenchido.presentes.has('inicio'),
              restDays: data.restDays,
              restDaysLabel,
              startDate,
            })
          : undefined,
      cid,
      text,
      observations: data.observations,
    };

    return { record, pdfData };
  }

  private async buildExamReferral(
    source: DocumentSource,
    data: CreateExamReferralDto | PreviewExamReferralDto,
    userId: string,
  ) {
    const { record, base, cidCodes, doctorId } = await this.buildBaseContext(
      source,
      userId,
    );
    const valores = this.placeholderValues(base);

    const indicacao =
      data.clinicalIndication !== undefined
        ? aplicarPlaceholdersDetalhado(data.clinicalIndication, valores)
        : await this.textoDoModelo(
            data.templateId,
            ClinicalDocumentTemplateKind.EXAM_REFERRAL,
            base,
            valores,
            doctorId,
            userId,
          );
    assertSemAfastamentoPendente(indicacao, 'pedido de exame');

    const pdfData: ExamReferralPdfData = {
      ...base,
      exams: data.exams,
      clinicalIndication: indicacao?.texto,
      cidCodes: data.cidCodes ?? cidCodes ?? undefined,
    };

    return { record, pdfData };
  }

  private async buildBaseContext(source: DocumentSource, userId: string) {
    await this.accessControlService.assertCanIssueClinicalDocuments(userId);

    const { record, patient, doctorId, cidCodes } = await this.resolveSubject(
      source,
      userId,
    );
    if (doctorId !== userId) {
      throw new ForbiddenException(MENSAGEM_SO_O_PROFISSIONAL_EMITE);
    }

    const { doctor, profile, doctorCrm, doctorSignatureUrl, customHeader } =
      await this.doctorPdfContextService.buildForDoctorId(doctorId);

    if (!hasCouncilRegistry(profile)) {
      throw new BadRequestException(
        `Preencha o número e a UF do ${profile?.council || 'CRM'} de ${doctor?.name ?? 'quem assina'} em Colaboradores antes de emitir documentos.`,
      );
    }

    const base = {
      today: todayBR(),
      ...(await this.buildPatientFields(patient)),
      doctorName: doctor?.name ?? 'Médico',
      doctorCrm,
      doctorSpecialty: profile?.specialty || undefined,
      doctorSignatureUrl,
      customHeader,
    };

    return {
      record,
      patient,
      cidCodes,
      base,
      doctorId,
      council: (profile?.council as string | undefined) ?? null,
    };
  }

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

  private async persist(
    record: ClinicalRecord,
    pdf: Buffer,
    type: string,
    label: string,
    userId: string,
  ) {
    const today = todayBR();
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
