import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bull';
import {
  ActivityType,
  SurgeryRequestActivity,
} from 'src/database/entities/surgery-request-activity.entity';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { User } from 'src/database/entities/user.entity';
import { ReportSection } from 'src/database/entities/report-section.entity';
import { PdfService } from './pdf.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { PdfGenerationJobData } from './pdf-generation.service';

@Processor('pdf-generation')
export class PdfGenerationProcessor {
  private readonly logger = new Logger(PdfGenerationProcessor.name);

  constructor(
    private readonly pdfService: PdfService,
    private readonly storageService: StorageService,
    @InjectRepository(SurgeryRequest)
    private readonly surgeryRequestRepo: Repository<SurgeryRequest>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(ReportSection)
    private readonly reportSectionRepo: Repository<ReportSection>,
    @InjectRepository(SurgeryRequestActivity)
    private readonly activityRepo: Repository<SurgeryRequestActivity>,
  ) {}

  @Process('generate-pdf')
  async handleGeneratePdf(job: Job<PdfGenerationJobData>): Promise<void> {
    const { surgeryRequestId, userId } = job.data;
    this.logger.log(
      `[PDF] Iniciando geração para solicitação: ${surgeryRequestId}`,
    );

    try {
      // ── Carregar solicitação com relações necessárias ─────────────────────
      const request = await this.surgeryRequestRepo.findOne({
        where: { id: surgeryRequestId },
        relations: [
          'created_by',
          'patient',
          'hospital',
          'health_plan',
          'tuss_items',
          'opme_items',
          'documents',
        ],
      });

      if (!request) {
        this.logger.warn(
          `[PDF] Solicitação não encontrada: ${surgeryRequestId}`,
        );
        return;
      }

      // ── Carregar médico com perfil ────────────────────────────────────────
      const doctorUserId = request.created_by_id || userId;
      const doctor = await this.userRepo.findOne({
        where: { id: doctorUserId },
        relations: ['doctor_profile'],
      });
      const profile = doctor?.doctor_profile;

      // ── Assinatura do médico ──────────────────────────────────────────────
      let doctorSignatureUrl: string | undefined;
      if (profile?.signature_url) {
        const rawSig: string = profile.signature_url;
        if (rawSig.startsWith('http')) {
          doctorSignatureUrl = rawSig;
        } else {
          try {
            doctorSignatureUrl = await this.storageService.getSignedUrl(rawSig);
          } catch {
            // sem assinatura
          }
        }
      }

      // ── Helpers de formatação ─────────────────────────────────────────────
      const digitsOnly = (v: string) => (v ? v.replace(/\D/g, '') : '');
      const formatPhone = (v: string) => {
        const d = digitsOnly(v).slice(0, 11);
        if (d.length <= 10) {
          return d.length > 6
            ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
            : d;
        }
        return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
      };
      const formatCpf = (v: string) => {
        const d = digitsOnly(v).slice(0, 11);
        if (d.length <= 3) return d;
        if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
        if (d.length <= 9)
          return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
        return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
      };
      const formatCep = (v: string) => {
        const d = digitsOnly(v).slice(0, 8);
        if (d.length <= 5) return d;
        return `${d.slice(0, 5)}-${d.slice(5)}`;
      };
      const formatDateBR = (v: string) => {
        if (!v) return '';
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return v;
        const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[3]}/${m[2]}/${m[1]}`;
        return v;
      };

      // ── CRM formatado ─────────────────────────────────────────────────────
      let doctorCrm: string | undefined;
      if (profile?.crm) {
        doctorCrm = `CRM ${profile.crm}${profile.crm_state ? `/${profile.crm_state}` : ''}`;
      }

      // ── Dados do laudo (medical_report JSON) ──────────────────────────────
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

      const pd = reportData.patientData ?? {};
      const patient = (request as any).patient;

      // ── Imagens dos exames (documentos com key report_images) ─────────────
      const allDocs = (request as any).documents ?? [];
      const examDocs = allDocs.filter((d: any) => d.key === 'report_images');
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

      // ── Procedimentos (TUSS) ──────────────────────────────────────────────
      const tussItems = (request as any).tuss_items ?? [];
      const procedures = tussItems.map((item: any) => ({
        name: item.name,
        tussCode: item.tuss_code,
        quantity: item.quantity ?? 1,
      }));

      // ── Materiais (OPME) ──────────────────────────────────────────────────
      const opmeItemsRaw = (request as any).opme_items ?? [];
      const opmeItems = opmeItemsRaw.map((item: any) => ({
        name: item.name,
        quantity: item.quantity ?? 1,
      }));

      // ── Fabricantes e Fornecedores ────────────────────────────────────────
      const unique = (arr: string[]) =>
        Array.from(new Set(arr.filter(Boolean)));
      const fabricantes = unique(
        opmeItemsRaw.map((i: any) => i.brand).filter(Boolean),
      );
      const fornecedores = unique(
        opmeItemsRaw.map((i: any) => i.distributor).filter(Boolean),
      );
      const fabricantesText =
        fabricantes.length > 0 ? fabricantes.join(', ') : '';
      const fornecedoresText =
        fornecedores.length > 0 ? fornecedores.join(', ') : '';
      const hasSeparator = fabricantes.length > 0 || fornecedores.length > 0;

      // ── Hospital (local) ──────────────────────────────────────────────────
      const hospital = (request as any).hospital;
      const localText = [hospital?.name, hospital?.address]
        .filter(Boolean)
        .join(' – ');

      const doctorEmail = doctor?.email ?? '';
      const doctorPhoneRaw = doctor?.phone ?? '';
      const doctorPhoneFormatted = formatPhone(doctorPhoneRaw);

      // ── Dados do laudo ────────────────────────────────────────────────────
      const laudoData: import('src/shared/pdf/pdf.service').SurgeryRequestLaudoPdfData =
        {
          today: new Date().toLocaleDateString('pt-BR'),
          patientName: pd.name || patient?.name || undefined,
          patientBirthDate:
            pd.birthDate ||
            (patient?.birth_date
              ? formatDateBR(patient.birth_date)
              : undefined),
          patientRg: pd.rg || patient?.rg || undefined,
          patientCpf: formatCpf(pd.cpf || patient?.cpf || '') || undefined,
          patientPhone:
            formatPhone(pd.phone || patient?.phone || '') || undefined,
          patientAddress: pd.address || patient?.address || undefined,
          patientZipCode:
            formatCep(pd.zipCode || patient?.zip_code || patient?.cep || '') ||
            undefined,
          patientHealthPlan:
            pd.healthPlan || (request as any).health_plan?.name || undefined,
          historyAndDiagnosis: reportData.historyAndDiagnosis || undefined,
          conduct: reportData.conduct || undefined,
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
        };

      // ── Gerar PDF do laudo ────────────────────────────────────────────────
      const summaryBuffer =
        await this.pdfService.generateSurgeryRequestLaudoPdf(laudoData);

      // ── Mesclar com documentos da aba Informações Gerais ──────────────────
      const infoDocs = allDocs.filter(
        (d: any) =>
          d.uri &&
          String(d.uri).startsWith('documents/') &&
          d.key !== 'report_images',
      );

      const docBuffers: Buffer[] = [];
      for (const doc of infoDocs) {
        try {
          const signedUrl = await this.storageService.getSignedUrl(doc.uri);
          const buf = await this.pdfService.fetchBuffer(signedUrl);
          if (buf) docBuffers.push(buf);
        } catch (err: any) {
          this.logger.warn(
            `[PDF] Não foi possível buscar documento "${doc.uri}": ${err?.message}`,
          );
        }
      }

      let finalBuffer = summaryBuffer;
      if (docBuffers.length > 0) {
        this.logger.log(
          `[PDF] Mesclando com ${docBuffers.length} documento(s) anexo(s)`,
        );
        finalBuffer = await this.pdfService.mergePdfs([
          summaryBuffer,
          ...docBuffers,
        ]);
      }

      // ── Fazer upload para Supabase Storage ────────────────────────────────
      const timestamp = Date.now();
      const filename = `solicitacao-${surgeryRequestId}-${timestamp}.pdf`;
      const mockFile = {
        originalname: filename,
        mimetype: 'application/pdf',
        buffer: finalBuffer,
      };
      const storagePath = await this.storageService.create(mockFile, 'pdfs');

      // ── Registrar atividade PDF_GENERATED ─────────────────────────────────
      const activityContent = JSON.stringify({
        description: 'PDF da solicitação gerado automaticamente',
        pdf_path: storagePath,
      });

      await this.activityRepo.save({
        surgery_request_id: surgeryRequestId,
        user_id: null,
        type: ActivityType.PDF_GENERATED,
        content: activityContent,
      });

      this.logger.log(
        `[PDF] PDF gerado e registrado com sucesso para solicitação: ${surgeryRequestId} → ${storagePath}`,
      );
    } catch (err: any) {
      this.logger.error(
        `[PDF] Falha ao gerar PDF para solicitação ${surgeryRequestId}: ${err?.message}`,
        err?.stack,
      );
      // Relança o erro para que o Bull registre a falha do job
      throw err;
    }
  }
}
