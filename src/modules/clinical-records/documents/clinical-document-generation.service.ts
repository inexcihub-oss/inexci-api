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

/** Limite da coluna `documents.name`. */
const DOCUMENT_NAME_MAX_LENGTH = 75;

const digitsOnly = (value?: string | null): string =>
  value ? value.replace(/\D/g, '') : '';

/** Contexto comum aos três documentos (paciente + profissional que assina). */
type BaseContext = Awaited<
  ReturnType<ClinicalDocumentGenerationService['buildBaseContext']>
>['base'];

/** Placeholders que o "aplicar modelo" deixa para a emissão preencher. */
const PREENCHIDOS_NA_EMISSAO = ['dias', 'inicio'] as const;

/**
 * Título do atestado pelo conselho de quem assina: o dentista (CRO) emite
 * atestado odontológico, não médico.
 */
const tituloDoAtestado = (council?: string | null): string =>
  council === ProfessionalCouncil.CRO
    ? 'ATESTADO ODONTOLÓGICO'
    : 'ATESTADO MÉDICO';

/**
 * Recusa de quem não é o profissional que assina. Receita, atestado e pedido
 * de exame saem com nome, registro e assinatura de quem assina — ninguém emite
 * (nem pré-visualiza) em nome de outro, nem um colega CRM/CRO com vínculo.
 */
export const MENSAGEM_SO_O_PROFISSIONAL_EMITE =
  'Só o profissional da consulta pode emitir este documento.';

/**
 * Linha de afastamento para o atestado com texto livre/modelo. A declaração
 * padrão imprime dias e início; o texto a substitui e, sem esta linha, o que o
 * médico preencheu no formulário sumia do PDF.
 *
 * A regra é estrutural, não pelo conteúdo do texto: a linha entra quando há
 * dias de afastamento e o texto **não** trazia `{{dias}}` (se trazia, os dias
 * já foram impressos no lugar do placeholder). Atestado de comparecimento é o
 * atestado sem `restDays`. O início explícito que o texto não traz (nem por
 * `{{inicio}}`, nem literal) também entra, para não sumir do documento.
 */
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

/** Placeholders de afastamento — só o atestado tem valor para eles. */
const PLACEHOLDERS_DE_AFASTAMENTO: readonly DocumentPlaceholder[] = [
  'dias',
  'inicio',
];

/**
 * Texto que ainda depende de `{{dias}}`/`{{inicio}}` sem valor sairia "por
 * dias" no PDF: recusa com 400 dizendo o que falta. Vale para emitir e para a
 * prévia (a montagem é a mesma).
 */
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
   * Exige o mesmo que emitir (médico ou dentista, com acesso ao paciente, e
   * ser o próprio profissional que assina): o texto devolvido já traz nome e
   * CPF do paciente.
   */
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
    // `{{dias}}`/`{{inicio}}` ficam sempre literais no texto aplicado: quem os
    // preenche é a prévia/emissão, com o afastamento escolhido naquela hora.
    // Antes o apply gravava "1 dia" no texto; o médico editava o texto, mudava
    // os dias para 3 e o PDF saía com "1 dia" no texto e "3 dias" na nota.
    // `restDays`/`startDate` do DTO são ignorados (ver o DTO).
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

  /**
   * Placeholders preenchidos e sem o título/assinatura que o PDF já imprime —
   * o modelo costuma ser escrito como o documento inteiro.
   */
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
    const { record, base, cidCodes, doctorId, council } =
      await this.buildBaseContext(source, userId);

    // O CID expõe o diagnóstico a quem recebe o atestado (empregador, escola),
    // então nunca entra sozinho: ou o médico escolhe o CID no atestado, ou
    // marca explicitamente para reaproveitar o da ficha.
    const cid = data.cid ?? (data.includeCid ? (cidCodes?.[0] ?? null) : null);

    const restDaysLabel = this.buildRestDaysLabel(data.restDays);
    const startDate = data.startDate ? formatDateBR(data.startDate) : undefined;
    // Sem início informado, o afastamento conta da emissão (ver o DTO).
    const valores = this.placeholderValues(
      base,
      data.restDays,
      startDate ?? (restDaysLabel ? base.today : undefined),
    );

    // O modelo é o texto do atestado: substitui a declaração padrão. Antes
    // ia para as observações e o atestado saía com o texto duas vezes. O
    // texto que já vem pronto (modelo aplicado na tela) ainda pode trazer
    // `{{dias}}`/`{{inicio}}` literais — preenchidos aqui com o valor final.
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
   * médico ou dentista (ato privativo), pertencer à clínica e **ser o próprio
   * profissional do documento**. O documento sai assinado com o nome, o
   * registro (CRM/CRO) e a imagem de assinatura desse profissional — ninguém
   * emite em nome de outro, nem um colega com vínculo (decisão de produto).
   *
   * Vale também para a prévia: é o mesmo documento, só que na tela.
   */
  private async buildBaseContext(source: DocumentSource, userId: string) {
    // Receita, atestado e pedido de exame são atos de médico (CRM) ou de
    // dentista (CRO), e só quem assina emite: o `doctorId` da ficha (ou o
    // informado na prévia sem ficha) tem que ser o próprio usuário.
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

    // Registro sem número ou sem UF sai do importador (profissional sem
    // conselho no Feegow e especialidade médica). Documento com o registro
    // pela metade não vale — recusa até alguém completá-lo em Colaboradores.
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

    // Sem ficha não há médico gravado: assina quem está pré-visualizando. Um
    // `doctorId` de outro profissional passa pelo recorte de acesso e é
    // recusado em `buildBaseContext` (só quem assina emite).
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
