import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bull';
import {
  ActivityType,
  SurgeryRequestActivity,
} from 'src/database/entities/surgery-request-activity.entity';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { StorageService } from 'src/shared/storage/storage.service';
import { PdfGenerationJobData } from './pdf-generation.service';
import { SurgeryRequestPdfAssemblyService } from 'src/modules/surgery-requests/services/surgery-request-pdf-assembly.service';

@Injectable()
@Processor('pdf-generation')
export class PdfGenerationProcessor {
  private readonly logger = new Logger(PdfGenerationProcessor.name);

  constructor(
    private readonly pdfAssemblyService: SurgeryRequestPdfAssemblyService,
    private readonly storageService: StorageService,
    @InjectRepository(SurgeryRequest)
    private readonly surgeryRequestRepo: Repository<SurgeryRequest>,
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
      // ── Carregar solicitação com todas as relações necessárias ─────────────
      const request = await this.surgeryRequestRepo.findOne({
        where: { id: surgeryRequestId },
        relations: [
          'createdBy',
          'patient',
          'hospital',
          'healthPlan',
          'tussItems',
          'opmeItems',
          'documents',
          'reportSections',
        ],
      });

      if (!request) {
        this.logger.warn(
          `[PDF] Solicitação não encontrada: ${surgeryRequestId}`,
        );
        return;
      }

      // ── Gerar PDF (mesclado com documentos anexos) via serviço compartilhado
      const doctorUserId = (request as any).createdById || userId;
      const { pdf } = await this.pdfAssemblyService.generateLaudoPdf(
        request,
        doctorUserId,
      );
      const finalBuffer = Buffer.from(pdf, 'base64');

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
      await this.activityRepo.save({
        surgeryRequestId: surgeryRequestId,
        userId: null,
        type: ActivityType.PDF_GENERATED,
        content: JSON.stringify({
          description: 'PDF da solicitação gerado automaticamente',
          pdf_path: storagePath,
        }),
      });

      this.logger.log(
        `[PDF] PDF gerado e registrado com sucesso para solicitação: ${surgeryRequestId} → ${storagePath}`,
      );
    } catch (err: any) {
      this.logger.error(
        `[PDF] Falha ao gerar PDF para solicitação ${surgeryRequestId}: ${err?.message}`,
        err?.stack,
      );
      throw err;
    }
  }
}
