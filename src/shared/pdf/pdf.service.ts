import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import * as Handlebars from 'handlebars';
import * as path from 'path';
import * as fs from 'fs';

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
  procedures?: Array<{ tussCode: string; description: string; quantity: number }>;
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

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

  private async htmlToPdf(html: string): Promise<Buffer> {
    let browser: puppeteer.Browser | null = null;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
        printBackground: true,
      });
      return Buffer.from(pdf);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}
