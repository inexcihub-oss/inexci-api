import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Payment } from 'src/database/entities/payment.entity';
import { FinanceReportsRepository } from 'src/database/repositories/finance-reports.repository';
import { PaymentReceiptIssueRepository } from 'src/database/repositories/payment-receipt-issue.repository';
import {
  DoctorPdfContext,
  DoctorPdfContextService,
} from 'src/shared/pdf/doctor-pdf-context.service';
import { PdfService, ReceiptPdfData } from 'src/shared/pdf/pdf.service';
import { formatCpf, formatDateBR, todayBR } from 'src/shared/utils';
import { errorMessage } from 'src/shared/utils/error-message.util';
import { ehPositivo } from '../utils/dinheiro';
import { formatarReais, valorPorExtenso } from '../utils/valor-por-extenso';
import { diaEmSaoPaulo, rotuloDaForma } from './finance-reports.service';

export function descreverFormaDePagamento(
  payment: Pick<Payment, 'method' | 'installments' | 'cardBrand'>,
): string {
  let texto = rotuloDaForma(payment.method);
  if (payment.installments > 1) texto += ` em ${payment.installments}x`;
  if (payment.cardBrand) texto += ` (${payment.cardBrand})`;
  return texto;
}

export function localEData(
  emissor: { city?: string | null; state?: string | null } | null | undefined,
  agora: Date,
): string {
  const hoje = todayBR(agora);
  const cidade = emissor?.city?.trim();
  if (!cidade) return hoje;
  const uf = emissor?.state?.trim();
  return `${cidade}${uf ? `/${uf}` : ''}, ${hoje}`;
}

@Injectable()
export class PaymentReceiptService {
  private readonly logger = new Logger(PaymentReceiptService.name);

  constructor(
    private readonly reportsRepository: FinanceReportsRepository,
    private readonly doctorPdfContextService: DoctorPdfContextService,
    private readonly pdfService: PdfService,
    private readonly receiptIssueRepository: PaymentReceiptIssueRepository,
  ) {}

  async pdf(
    ownerId: string,
    emitidoPor: string,
    paymentId: string,
  ): Promise<Buffer> {
    const dados = await this.montarDados(ownerId, paymentId, { emitidoPor });
    const arquivo = await this.pdfService.generateReceiptPdf(dados);
    await this.receiptIssueRepository.register({
      ownerId,
      paymentId,
      issuedById: emitidoPor,
      withSignature: !!dados.doctorSignatureUrl,
    });
    return arquivo;
  }

  async preview(
    ownerId: string,
    emitidoPor: string,
    paymentId: string,
  ): Promise<string> {
    const dados = await this.montarDados(ownerId, paymentId, { emitidoPor });
    return this.pdfService.renderClinicalDocumentHtml('receipt', dados);
  }

  async montarDados(
    ownerId: string,
    paymentId: string,
    opcoes: { emitidoPor?: string | null; agora?: Date } = {},
  ): Promise<ReceiptPdfData> {
    const agora = opcoes.agora ?? new Date();
    const payment = await this.reportsRepository.dadosDoRecibo(
      ownerId,
      paymentId,
    );
    if (!payment) throw new NotFoundException('Pagamento não encontrado');

    const itens = (payment.receivable?.items ?? []).filter(
      (item) => !item.cancelledAt,
    );
    const executante = itens.find((item) => item.executedById)?.executedById;
    const emissor = await this.contextoDoEmissor(ownerId, executante ?? null);
    const assinaQuemEmite =
      !!executante &&
      !!opcoes.emitidoPor &&
      opcoes.emitidoPor === executante &&
      emissor.doctor?.id === executante;

    const descricoes = itens
      .map((item) => item.description?.trim())
      .filter((descricao): descricao is string => !!descricao);
    const patient = payment.receivable.patient;

    return {
      today: todayBR(agora),
      patientName: patient?.name ?? 'Paciente',
      patientCpf: patient?.cpf ? formatCpf(patient.cpf) : undefined,
      amount: formatarReais(payment.amount),
      amountInWords: valorPorExtenso(payment.amount),
      description: descricoes.length
        ? descricoes.join(', ')
        : 'serviços prestados',
      paymentMethod: descreverFormaDePagamento(payment),
      paidAt: formatDateBR(diaEmSaoPaulo(new Date(payment.paidAt))),
      placeAndDate: localEData(emissor.doctor, agora),
      showPlaceAndDate:
        !!emissor.customHeader || !!emissor.doctor?.city?.trim(),
      refundedAmount: ehPositivo(payment.refundedAmount)
        ? formatarReais(payment.refundedAmount)
        : undefined,
      doctorName: emissor.doctor?.name ?? '',
      doctorCrm: emissor.doctorCrm,
      doctorSpecialty: emissor.profile?.specialty || undefined,
      doctorSignatureUrl: assinaQuemEmite
        ? emissor.doctorSignatureUrl
        : undefined,
      customHeader: emissor.customHeader,
    };
  }

  private async contextoDoEmissor(
    ownerId: string,
    executanteId: string | null,
  ): Promise<DoctorPdfContext> {
    if (executanteId) {
      try {
        const contexto =
          await this.doctorPdfContextService.buildForDoctorId(executanteId);
        const tenant = contexto.doctor.ownerId ?? contexto.doctor.id;
        if (tenant === ownerId) return contexto;
      } catch (err: unknown) {
        this.logger.warn(
          `[recibo] executante ${executanteId} indisponível: ${errorMessage(err)}`,
        );
      }
    }
    return this.doctorPdfContextService.buildForDoctorId(ownerId);
  }
}
