import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import * as Handlebars from 'handlebars';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';

export interface SurgeryRequestPdfData {
  id: string;
  protocol?: string;
  status: string;
  createdAt: string;
  sentAt?: string;

  // Médico
  doctorName: string;
  doctorCrm?: string;

  // Paciente
  patientName: string;
  patientBirthDate?: string;
  patientCpf?: string;
  patientPhone?: string;

  // Convênio
  healthPlanName?: string;
  healthPlanRegistration?: string;
  healthPlanType?: string;
  healthPlanProtocol?: string;

  // Hospital
  hospitalName?: string;

  // Diagnóstico
  cid?: string;
  cidDescription?: string;
  diagnosis?: string;
  medicalReport?: string;

  // Procedimentos
  procedures?: Array<{
    tussCode: string;
    description: string;
    quantity: number;
    authorizedQuantity?: number;
  }>;

  // OPME
  opmeItems?: Array<{
    name: string;
    brand?: string;
    quantity: number;
    authorizedQuantity?: number;
  }>;

  // Datas
  surgeryDate?: string;
  surgeryPerformedAt?: string;

  // Análise
  analysis?: {
    requestNumber?: string;
    receivedAt?: string;
    notes?: string;
  };

  // Faturamento
  billing?: {
    invoiceProtocol?: string;
    invoiceValue?: string;
    invoiceSentAt?: string;
    paymentDeadline?: string;
    receivedValue?: string;
    receivedAt?: string;
  };
}

export interface InvoicePdfData {
  id: string;
  protocol?: string;
  patientName: string;
  healthPlanName?: string;
  hospitalName?: string;
  doctorName: string;
  surgeryDate?: string;
  invoiceProtocol: string;
  invoiceValue: string;
  invoiceSentAt: string;
  paymentDeadline?: string;
  procedures?: Array<{
    tussCode: string;
    description: string;
    quantity: number;
  }>;
}

export interface MedicalReportPdfData {
  today: string;
  // Paciente
  patientName?: string;
  patientBirthDate?: string;
  patientRg?: string;
  patientCpf?: string;
  patientPhone?: string;
  patientAddress?: string;
  patientZipCode?: string;
  patientHealthPlan?: string;
  // Conteúdo do laudo
  historyAndDiagnosis?: string;
  conduct?: string;
  // Imagens (data URIs ou signed URLs)
  examImages?: string[];
  // Médico
  doctorName: string;
  doctorCrm?: string;
  doctorCrmState?: string;
  doctorSpecialty?: string;
  doctorSignatureUrl?: string;
}

export interface ContestAuthorizationPdfData {
  today: string;
  // Texto da contestação (redigido pelo médico)
  reason: string;
  // Paciente
  patientName?: string;
  patientBirthDate?: string;
  patientRg?: string;
  patientCpf?: string;
  patientPhone?: string;
  patientAddress?: string;
  patientZipCode?: string;
  patientHealthPlan?: string;
  // Procedimentos solicitados
  procedures?: Array<{
    description: string;
    tussCode?: string;
    requestedQuantity: number;
    authorizedQuantity?: number | null;
  }>;
  // Materiais / OPME
  opmeItems?: Array<{
    name: string;
    requestedQuantity: number;
    authorizedQuantity?: number | null;
  }>;
  // Anexos (data URIs ou signed URLs)
  attachments?: string[];
  // Médico
  doctorName: string;
  doctorCrm?: string;
  doctorSpecialty?: string;
  doctorSignatureUrl?: string;
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  constructor() {
    // Helper para checar se um valor foi definido (inclusive 0)
    Handlebars.registerHelper(
      'isDefined',
      (value: any) => value !== undefined && value !== null,
    );
  }

  /**
   * Gera o PDF do laudo médico seguindo o template Figma.
   */
  async generateMedicalReportPdf(data: MedicalReportPdfData): Promise<Buffer> {
    // Pré-carregar imagens dos exames como data URIs para garantir que
    // o Puppeteer as renderize corretamente mesmo dentro do Docker.
    const resolvedImages: string[] = [];
    if (data.examImages?.length) {
      for (const url of data.examImages) {
        const dataUri = await this.fetchAsDataUri(url);
        // Se falhar, usa a URL diretamente (Puppeteer tenta carregar)
        resolvedImages.push(dataUri ?? url);
      }
    }

    // Resolver assinatura do médico
    let signatureUri: string | undefined;
    if (data.doctorSignatureUrl) {
      const dataUri = await this.fetchAsDataUri(data.doctorSignatureUrl);
      signatureUri = dataUri ?? data.doctorSignatureUrl;
    }

    const templateData = {
      ...data,
      examImages: resolvedImages.length ? resolvedImages : undefined,
      doctorSignatureUrl: signatureUri,
    };

    const html = this.renderTemplate('medical-report', templateData);
    return this.htmlToPdf(html, {
      format: 'A4',
      margin: { top: '12mm', right: '12mm', bottom: '16mm', left: '12mm' },
    });
  }

  /**
   * Busca uma URL remota e retorna como data URI (base64).
   * Segue redirects HTTP (até 10 saltos) e loga erros.
   * Retorna null em caso de falha para não bloquear a geração do PDF.
   */
  private fetchAsDataUri(url: string, depth = 0): Promise<string | null> {
    if (depth > 10) {
      this.logger.warn(`fetchAsDataUri: muitos redirects para ${url}`);
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      try {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { timeout: 20000 }, (res) => {
          this.logger.debug(
            `fetchAsDataUri [${depth}] status=${res.statusCode} url=${url.substring(0, 80)}`,
          );

          // Seguir redirecionamentos (301, 302, 303, 307, 308)
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume(); // Descartar corpo da resposta de redirect
            const location = res.headers.location;
            // Montar URL absoluta se vier relativa
            const nextUrl = location.startsWith('http')
              ? location
              : new URL(location, url).href;
            this.fetchAsDataUri(nextUrl, depth + 1).then(resolve);
            return;
          }

          if (res.statusCode && res.statusCode >= 400) {
            this.logger.warn(
              `fetchAsDataUri: HTTP ${res.statusCode} para ${url.substring(0, 80)}`,
            );
            res.resume();
            resolve(null);
            return;
          }

          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const contentType = (res.headers['content-type'] || 'image/jpeg')
              .split(';')[0]
              .trim();
            const base64 = Buffer.concat(chunks).toString('base64');
            this.logger.debug(
              `fetchAsDataUri: OK contentType=${contentType} bytes=${Buffer.concat(chunks).length}`,
            );
            resolve(`data:${contentType};base64,${base64}`);
          });
          res.on('error', (err) => {
            this.logger.warn(`fetchAsDataUri: erro no stream: ${err.message}`);
            resolve(null);
          });
        });
        req.on('error', (err) => {
          this.logger.warn(`fetchAsDataUri: req error: ${err.message}`);
          resolve(null);
        });
        req.on('timeout', () => {
          this.logger.warn(
            `fetchAsDataUri: timeout para ${url.substring(0, 80)}`,
          );
          req.destroy();
          resolve(null);
        });
      } catch (err: any) {
        this.logger.warn(`fetchAsDataUri: exceção: ${err?.message}`);
        resolve(null);
      }
    });
  }

  /**
   * Gera o PDF de resumo da solicitação cirúrgica.
   */
  async generateSurgeryRequestSummary(
    data: SurgeryRequestPdfData,
  ): Promise<Buffer> {
    const html = this.renderTemplate('surgery-request', data);
    return this.htmlToPdf(html);
  }

  /**
   * Gera o PDF de relatório de faturamento.
   */
  async generateInvoiceReport(data: InvoicePdfData): Promise<Buffer> {
    const html = this.renderTemplate('invoice-report', data);
    return this.htmlToPdf(html);
  }

  /**
   * Gera o PDF de contestação à negativa de autorização cirúrgica.
   */
  async generateContestAuthorizationPdf(
    data: ContestAuthorizationPdfData,
  ): Promise<Buffer> {
    // Pré-carregar anexos como data URIs
    const resolvedAttachments: string[] = [];
    if (data.attachments?.length) {
      for (const url of data.attachments) {
        const dataUri = await this.fetchAsDataUri(url);
        resolvedAttachments.push(dataUri ?? url);
      }
    }

    // Resolver assinatura do médico
    let signatureUri: string | undefined;
    if (data.doctorSignatureUrl) {
      const dataUri = await this.fetchAsDataUri(data.doctorSignatureUrl);
      signatureUri = dataUri ?? data.doctorSignatureUrl;
    }

    const templateData = {
      ...data,
      attachments: resolvedAttachments.length ? resolvedAttachments : undefined,
      doctorSignatureUrl: signatureUri,
    };

    const html = this.renderTemplate('contest-authorization', templateData);
    return this.htmlToPdf(html, {
      format: 'A4',
      margin: { top: '12mm', right: '12mm', bottom: '16mm', left: '12mm' },
    });
  }

  private renderTemplate(
    templateName: string,
    context: Record<string, any>,
  ): string {
    const templatePath = path.join(
      __dirname,
      'templates',
      `${templateName}.hbs`,
    );

    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template de PDF não encontrado: ${templateName}`);
    }

    const source = fs.readFileSync(templatePath, 'utf-8');
    const compiled = Handlebars.compile(source);
    return compiled(context);
  }

  private async htmlToPdf(
    html: string,
    pdfOptions?: Partial<puppeteer.PDFOptions>,
  ): Promise<Buffer> {
    let browser: puppeteer.Browser | null = null;
    try {
      browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle2' });
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
        printBackground: true,
        ...pdfOptions,
      });
      return Buffer.from(pdf);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}
