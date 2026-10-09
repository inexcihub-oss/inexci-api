import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as puppeteer from 'puppeteer';
import * as Handlebars from 'handlebars';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';

export interface CustomHeaderData {
  logoUrl?: string | null;
  logoPosition: 'left' | 'center' | 'right';
  contentHtml?: string | null;
}

export interface SurgeryRequestPdfData {
  id: string;
  protocol?: string;
  status: string;
  createdAt: string;
  sentAt?: string;

  doctorName: string;
  doctorCrm?: string;

  patientName: string;
  patientBirthDate?: string;
  patientCpf?: string;
  patientPhone?: string;

  healthPlanName?: string;
  healthPlanRegistration?: string;
  healthPlanType?: string;
  healthPlanProtocol?: string;

  hospitalName?: string;

  cid?: string;
  cidDescription?: string;
  diagnosis?: string;
  medicalReport?: string;

  procedures?: Array<{
    tussCode: string;
    description: string;
    quantity: number;
    authorizedQuantity?: number;
  }>;

  opmeItems?: Array<{
    name: string;
    quantity: number;
    authorizedQuantity?: number;
    fabricantesText?: string;
    fornecedoresText?: string;
  }>;

  surgeryDate?: string;
  surgeryPerformedAt?: string;

  analysis?: {
    requestNumber?: string;
    receivedAt?: string;
    notes?: string;
  };

  billing?: {
    invoiceProtocol?: string;
    invoiceValue?: string;
    invoiceSentAt?: string;
    paymentDeadline?: string;
    receivedValue?: string;
    receivedAt?: string;
  };

  customHeader?: CustomHeaderData | null;
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
  patientName?: string;
  patientBirthDate?: string;
  patientRg?: string;
  patientCpf?: string;
  patientPhone?: string;
  patientAddress?: string;
  patientZipCode?: string;
  patientHealthPlan?: string;
  patientHealthPlanNumber?: string;
  sections?: Array<{ title: string; description?: string | null }>;
  historyAndDiagnosis?: string;
  conduct?: string;
  examImages?: string[];
  doctorName: string;
  doctorCrm?: string;
  doctorCrmState?: string;
  doctorSpecialty?: string;
  doctorSignatureUrl?: string;

  customHeader?: CustomHeaderData | null;
}

export interface ContestAuthorizationPdfData {
  today: string;
  reason: string;
  message?: string;
  patientName?: string;
  patientBirthDate?: string;
  patientRg?: string;
  patientCpf?: string;
  patientPhone?: string;
  patientAddress?: string;
  patientZipCode?: string;
  patientHealthPlan?: string;
  patientHealthPlanNumber?: string;
  procedures?: Array<{
    description: string;
    tussCode?: string;
    requestedQuantity: number;
    authorizedQuantity?: number | null;
  }>;
  opmeItems?: Array<{
    name: string;
    requestedQuantity: number;
    authorizedQuantity?: number | null;
    fabricantesText?: string;
    fornecedoresText?: string;
  }>;
  attachments?: string[];
  doctorName: string;
  doctorCrm?: string;
  doctorSpecialty?: string;
  doctorSignatureUrl?: string;

  customHeader?: CustomHeaderData | null;
}

export interface SurgeryRequestLaudoPdfData {
  today: string;
  patientName?: string;
  patientBirthDate?: string;
  patientRg?: string;
  patientCpf?: string;
  patientPhone?: string;
  patientAddress?: string;
  patientZipCode?: string;
  patientHealthPlan?: string;
  patientHealthPlanNumber?: string;
  historyAndDiagnosis?: string;
  conduct?: string;
  examImages?: string[];
  procedures?: Array<{
    name: string;
    tussCode: string;
    quantity: number;
  }>;
  opmeItems?: Array<{
    name: string;
    quantity: number;
    fabricantesText?: string;
    fornecedoresText?: string;
  }>;
  fabricantesText?: string;
  fornecedoresText?: string;
  hasSeparator?: boolean;
  sections?: Array<{ title: string; description?: string | null }>;
  localText?: string;
  doctorName: string;
  doctorEmail?: string;
  doctorPhone?: string;
  doctorSpecialty?: string;
  doctorCrm?: string;
  hasDoctorContact?: boolean;
  hasDoctorInfo?: boolean;
  doctorSignatureUrl?: string;

  customHeader?: CustomHeaderData | null;
}

export interface PrescriptionItem {
  name: string;
  quantity?: string;
  instructions?: string;
}

export interface ExamReferralItem {
  name: string;
  tussCode?: string;
  observation?: string;
}

export interface ClinicalDocumentPatientFields {
  patientName?: string;
  patientBirthDate?: string;
  patientRg?: string;
  patientCpf?: string;
  patientPhone?: string;
  patientAddress?: string;
  patientHealthPlan?: string;
  patientHealthPlanNumber?: string;
}

export interface ClinicalDocumentDoctorFields {
  doctorName: string;
  doctorCrm?: string;
  doctorSpecialty?: string;
  doctorSignatureUrl?: string;
  customHeader?: CustomHeaderData | null;
}

export interface PrescriptionPdfData
  extends ClinicalDocumentPatientFields, ClinicalDocumentDoctorFields {
  today: string;
  items: PrescriptionItem[];
  notes?: string;
}

export interface MedicalCertificatePdfData
  extends ClinicalDocumentPatientFields, ClinicalDocumentDoctorFields {
  today: string;
  certificateTitle?: string;
  restDaysLabel?: string;
  startDate?: string;
  restPeriodNote?: string;
  cid?: { code: string; description?: string } | null;
  text?: string;
  observations?: string;
}

export interface ExamReferralPdfData
  extends ClinicalDocumentPatientFields, ClinicalDocumentDoctorFields {
  today: string;
  exams: ExamReferralItem[];
  clinicalIndication?: string;
  cidCodes?: Array<{ code: string; description?: string }>;
}

const CLINICAL_DOCUMENT_PDF_OPTIONS = {
  format: 'A4' as const,
  margin: { top: '14mm', right: '14mm', bottom: '16mm', left: '14mm' },
};

const ALLOWED_URL_HOSTS = ['r2.cloudflarestorage.com'];

export function isAllowedHost(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== 'https:') return false;
    return ALLOWED_URL_HOSTS.some(
      (h) => hostname === h || hostname.endsWith(`.${h}`),
    );
  } catch {
    return false;
  }
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  private partialsRegistered = false;

  constructor(private readonly configService: ConfigService) {
    Handlebars.registerHelper(
      'isDefined',
      (value: any) => value !== undefined && value !== null,
    );
    Handlebars.registerHelper(
      'sum',
      (a: number, b: number) => Number(a) + Number(b),
    );
  }

  async generatePrescriptionPdf(data: PrescriptionPdfData): Promise<Buffer> {
    const html = await this.renderClinicalDocument('prescription', data);
    return this.htmlToPdf(html, CLINICAL_DOCUMENT_PDF_OPTIONS);
  }

  async generateMedicalCertificatePdf(
    data: MedicalCertificatePdfData,
  ): Promise<Buffer> {
    const html = await this.renderClinicalDocument('medical-certificate', data);
    return this.htmlToPdf(html, CLINICAL_DOCUMENT_PDF_OPTIONS);
  }

  async generateExamReferralPdf(data: ExamReferralPdfData): Promise<Buffer> {
    const html = await this.renderClinicalDocument('exam-referral', data);
    return this.htmlToPdf(html, CLINICAL_DOCUMENT_PDF_OPTIONS);
  }

  renderClinicalDocumentHtml(
    templateName: string,
    data: ClinicalDocumentDoctorFields & Record<string, any>,
  ): Promise<string> {
    return this.renderTemplate(templateName, {
      ...data,
      customHeader: data.customHeader || undefined,
    });
  }

  private async renderClinicalDocument(
    templateName: string,
    data: ClinicalDocumentDoctorFields & Record<string, any>,
  ): Promise<string> {
    let doctorSignatureUrl: string | undefined;
    if (data.doctorSignatureUrl) {
      const dataUri = await this.fetchAsDataUri(data.doctorSignatureUrl);
      doctorSignatureUrl = dataUri ?? data.doctorSignatureUrl;
    }

    let customHeader = data.customHeader ?? null;
    if (customHeader?.logoUrl) {
      const dataUri = await this.fetchAsDataUri(customHeader.logoUrl);
      customHeader = {
        ...customHeader,
        logoUrl: dataUri ?? customHeader.logoUrl,
      };
    }

    return this.renderTemplate(templateName, {
      ...data,
      doctorSignatureUrl,
      customHeader: customHeader || undefined,
    });
  }

  async generateMedicalReportPdf(data: MedicalReportPdfData): Promise<Buffer> {
    const resolvedImages: string[] = [];
    if (data.examImages?.length) {
      for (const url of data.examImages) {
        const dataUri = await this.fetchAsDataUri(url);
        resolvedImages.push(dataUri ?? url);
      }
    }

    let signatureUri: string | undefined;
    if (data.doctorSignatureUrl) {
      const dataUri = await this.fetchAsDataUri(data.doctorSignatureUrl);
      signatureUri = dataUri ?? data.doctorSignatureUrl;
    }

    let customHeader = data.customHeader ?? null;
    if (customHeader?.logoUrl) {
      const dataUri = await this.fetchAsDataUri(customHeader.logoUrl);
      customHeader = {
        ...customHeader,
        logoUrl: dataUri ?? customHeader.logoUrl,
      };
    }

    const templateData = {
      ...data,
      examImages: resolvedImages.length ? resolvedImages : undefined,
      doctorSignatureUrl: signatureUri,
      customHeader: customHeader || undefined,
    };

    const html = await this.renderTemplate('medical-report', templateData);
    return this.htmlToPdf(html, {
      format: 'A4',
      margin: { top: '12mm', right: '12mm', bottom: '16mm', left: '12mm' },
    });
  }

  private fetchAsDataUri(url: string, depth = 0): Promise<string | null> {
    if (depth > 10) {
      this.logger.warn(`fetchAsDataUri: muitos redirects para ${url}`);
      return Promise.resolve(null);
    }
    if (!isAllowedHost(url)) {
      this.logger.warn(
        `fetchAsDataUri: SSRF bloqueado — host não permitido: ${url.substring(0, 80)}`,
      );
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      try {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { timeout: 20000 }, (res) => {
          this.logger.debug(
            `fetchAsDataUri [${depth}] status=${res.statusCode} url=${url.substring(0, 80)}`,
          );

          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            const location = res.headers.location;
            const nextUrl = location.startsWith('http')
              ? location
              : new URL(location, url).href;
            if (!isAllowedHost(nextUrl)) {
              this.logger.warn(
                `fetchAsDataUri: redirect para host não permitido bloqueado — ${nextUrl}`,
              );
              resolve(null);
              return;
            }
            void this.fetchAsDataUri(nextUrl, depth + 1).then(resolve);
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

  async fetchBuffer(url: string, depth = 0): Promise<Buffer | null> {
    if (depth > 10) return null;
    if (!isAllowedHost(url)) {
      this.logger.warn(`fetchBuffer: host não permitido bloqueado — ${url}`);
      return null;
    }
    return new Promise((resolve) => {
      try {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { timeout: 20000 }, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            const nextUrl = res.headers.location.startsWith('http')
              ? res.headers.location
              : new URL(res.headers.location, url).href;
            if (!isAllowedHost(nextUrl)) {
              this.logger.warn(
                `fetchBuffer: redirect para host não permitido bloqueado — ${nextUrl}`,
              );
              resolve(null);
              return;
            }
            void this.fetchBuffer(nextUrl, depth + 1).then(resolve);
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            res.resume();
            resolve(null);
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', () => resolve(null));
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => {
          req.destroy();
          resolve(null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  async mergePdfs(buffers: Buffer[]): Promise<Buffer> {
    const { PDFDocument } = await import('pdf-lib');
    const merged = await PDFDocument.create();

    for (const buf of buffers) {
      try {
        const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
        const copied = await merged.copyPages(doc, doc.getPageIndices());
        copied.forEach((p) => merged.addPage(p));
        continue;
      } catch {}

      const a4W = 595.28;
      const a4H = 841.89;
      try {
        let embedded: any;
        let w: number;
        let h: number;
        try {
          embedded = await merged.embedPng(buf);
          const dims = embedded.size();
          w = dims.width;
          h = dims.height;
        } catch {
          embedded = await merged.embedJpg(buf);
          const dims = embedded.size();
          w = dims.width;
          h = dims.height;
        }
        const scale = Math.min(a4W / w, a4H / h, 1);
        const page = merged.addPage([a4W, a4H]);
        page.drawImage(embedded, {
          x: (a4W - w * scale) / 2,
          y: (a4H - h * scale) / 2,
          width: w * scale,
          height: h * scale,
        });
      } catch {
        this.logger.warn(
          '[mergePdfs] Não foi possível incorporar anexo, pulando.',
        );
      }
    }

    return Buffer.from(await merged.save());
  }

  async generateSurgeryRequestLaudoPdf(
    data: SurgeryRequestLaudoPdfData,
  ): Promise<Buffer> {
    const resolvedImages: string[] = [];
    if (data.examImages?.length) {
      for (const url of data.examImages) {
        const dataUri = await this.fetchAsDataUri(url);
        resolvedImages.push(dataUri ?? url);
      }
    }

    let signatureUri: string | undefined;
    if (data.doctorSignatureUrl) {
      const dataUri = await this.fetchAsDataUri(data.doctorSignatureUrl);
      signatureUri = dataUri ?? data.doctorSignatureUrl;
    }

    let customHeader = data.customHeader ?? null;
    if (customHeader?.logoUrl) {
      const dataUri = await this.fetchAsDataUri(customHeader.logoUrl);
      customHeader = {
        ...customHeader,
        logoUrl: dataUri ?? customHeader.logoUrl,
      };
    }

    const templateData = {
      ...data,
      examImages: resolvedImages.length ? resolvedImages : undefined,
      doctorSignatureUrl: signatureUri,
      customHeader: customHeader || undefined,
    };

    const html = await this.renderTemplate(
      'surgery-request-laudo',
      templateData,
    );
    return this.htmlToPdf(html, {
      format: 'A4',
      margin: { top: '32px', right: '32px', bottom: '32px', left: '32px' },
    });
  }

  async generateSurgeryRequestSummary(
    data: SurgeryRequestPdfData,
  ): Promise<Buffer> {
    let customHeader = data.customHeader ?? null;
    if (customHeader?.logoUrl) {
      const dataUri = await this.fetchAsDataUri(customHeader.logoUrl);
      customHeader = {
        ...customHeader,
        logoUrl: dataUri ?? customHeader.logoUrl,
      };
    }

    const templateData = { ...data, customHeader: customHeader || undefined };
    const html = await this.renderTemplate('surgery-request', templateData);
    return this.htmlToPdf(html);
  }

  async generateInvoiceReport(data: InvoicePdfData): Promise<Buffer> {
    const html = await this.renderTemplate('invoice-report', data);
    return this.htmlToPdf(html);
  }

  async generateContestAuthorizationPdf(
    data: ContestAuthorizationPdfData,
  ): Promise<Buffer> {
    const resolvedAttachments: string[] = [];
    if (data.attachments?.length) {
      for (const url of data.attachments) {
        const dataUri = await this.fetchAsDataUri(url);
        resolvedAttachments.push(dataUri ?? url);
      }
    }

    let signatureUri: string | undefined;
    if (data.doctorSignatureUrl) {
      const dataUri = await this.fetchAsDataUri(data.doctorSignatureUrl);
      signatureUri = dataUri ?? data.doctorSignatureUrl;
    }

    let customHeader = data.customHeader ?? null;
    if (customHeader?.logoUrl) {
      const dataUri = await this.fetchAsDataUri(customHeader.logoUrl);
      customHeader = {
        ...customHeader,
        logoUrl: dataUri ?? customHeader.logoUrl,
      };
    }

    const templateData = {
      ...data,
      attachments: resolvedAttachments.length ? resolvedAttachments : undefined,
      doctorSignatureUrl: signatureUri,
      customHeader: customHeader || undefined,
    };

    const html = await this.renderTemplate(
      'contest-authorization',
      templateData,
    );
    return this.htmlToPdf(html, {
      format: 'A4',
      margin: { top: '12mm', right: '12mm', bottom: '16mm', left: '12mm' },
    });
  }

  private resolveTemplatesDir(): string[] {
    return [
      path.join(__dirname, 'templates'),
      path.join(__dirname, '..', '..', '..', 'shared', 'pdf', 'templates'),
      path.join(process.cwd(), 'src', 'shared', 'pdf', 'templates'),
      path.join(process.cwd(), 'dist', 'shared', 'pdf', 'templates'),
    ];
  }

  private async findTemplatePath(filename: string): Promise<string | null> {
    for (const dir of this.resolveTemplatesDir()) {
      const candidate = path.join(dir, filename);
      try {
        await fs.promises.access(candidate);
        return candidate;
      } catch {}
    }
    return null;
  }

  private async registerPartials(): Promise<void> {
    if (this.partialsRegistered) return;

    for (const dir of this.resolveTemplatesDir()) {
      const partialsDir = path.join(dir, 'partials');
      let files: string[];
      try {
        files = await fs.promises.readdir(partialsDir);
      } catch {
        continue;
      }

      for (const file of files.filter((f) => f.endsWith('.hbs'))) {
        const source = await fs.promises.readFile(
          path.join(partialsDir, file),
          'utf-8',
        );
        Handlebars.registerPartial(path.basename(file, '.hbs'), source);
      }
      this.partialsRegistered = true;
      return;
    }
  }

  private async renderTemplate(
    templateName: string,
    context: Record<string, any>,
  ): Promise<string> {
    await this.registerPartials();

    const templatePath = await this.findTemplatePath(`${templateName}.hbs`);

    if (!templatePath) {
      throw new Error(`Template de PDF não encontrado: ${templateName}`);
    }

    const source = await fs.promises.readFile(templatePath, 'utf-8');
    const compiled = Handlebars.compile(source);
    return compiled(context);
  }

  private async htmlToPdf(
    html: string,
    pdfOptions?: Partial<puppeteer.PDFOptions>,
  ): Promise<Buffer> {
    let browser: puppeteer.Browser | null = null;
    try {
      const executablePath = await this.resolvePuppeteerExecutablePath();

      browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      const page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.url().startsWith('data:')) return void req.continue();
        return void req.abort();
      });
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
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

  private async resolvePuppeteerExecutablePath(): Promise<string | undefined> {
    const configuredPath = this.configService
      .get<string>('PUPPETEER_EXECUTABLE_PATH')
      ?.trim();

    const candidates = [
      configuredPath,
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/snap/bin/chromium',
    ].filter((value, index, arr): value is string => {
      return Boolean(value) && arr.indexOf(value) === index;
    });

    for (const candidate of candidates) {
      try {
        await fs.promises.access(candidate, fs.constants.X_OK);

        if (configuredPath && candidate !== configuredPath) {
          this.logger.warn(
            `PUPPETEER_EXECUTABLE_PATH inválido (${configuredPath}). Usando fallback: ${candidate}`,
          );
        }

        return candidate;
      } catch {}
    }

    if (configuredPath) {
      this.logger.warn(
        `PUPPETEER_EXECUTABLE_PATH configurado mas não encontrado: ${configuredPath}`,
      );
    }

    return undefined;
  }
}
