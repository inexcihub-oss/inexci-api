import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  FinancialEntryDirection,
  FinancialEntryKind,
} from 'src/database/entities/financial-entry.entity';
import {
  PAYMENT_IDEMPOTENCY_KEY_UNICA,
  Payment,
} from 'src/database/entities/payment.entity';
import { PaymentMethod } from 'src/database/entities/payment-method-config.entity';
import { CashSessionRepository } from 'src/database/repositories/cash-session.repository';
import { FinancialEntryRepository } from 'src/database/repositories/financial-entry.repository';
import { PaymentRepository } from 'src/database/repositories/payment.repository';
import { violouIndice } from 'src/database/repositories/unique-violation.util';
import { Permission } from 'src/shared/permissions';
import { paginacao } from '../dto/finance-common.dto';
import {
  FindPaymentsDto,
  PaymentLineDto,
  PaymentListResponseDto,
  RegisterPaymentDto,
} from '../dto/payment.dto';
import { ReceivableDetailDto } from '../dto/receivable.dto';
import { referencia } from '../mappers/receivable.mapper';
import {
  compararValores,
  ehPositivo,
  normalizarValor,
  somar,
  subtrair,
} from '../utils/dinheiro';
import { validarDataDoLancamento } from '../utils/data-do-lancamento';
import { ROTULO_DA_FORMA_DE_PAGAMENTO } from '../utils/rotulos-financeiros';
import { FinancialAccountsService } from './financial-accounts.service';
import {
  PARCELAS_SO_NO_CREDITO,
  PaymentMethodConfigsService,
} from './payment-method-configs.service';
import { ReceivablesService } from './receivables.service';

export const PAGAMENTO_NAO_ENCONTRADO = 'Pagamento não encontrado';
export const PAGAMENTO_ACIMA_DO_SALDO =
  'O valor recebido passa do saldo devedor da cobrança';
export const DINHEIRO_SEM_CAIXA = 'Abra o caixa para receber em dinheiro';
export const VALOR_DA_LINHA_INVALIDO =
  'O valor de cada forma de pagamento deve ser maior que zero';
export const DINHEIRO_ANTES_DA_ABERTURA =
  'O pagamento em dinheiro não pode ser anterior à abertura do caixa';
export const CHAVE_DE_OUTRA_COBRANCA =
  'Esta chave de idempotência já foi usada em outra cobrança';

interface LinhaResolvida {
  linha: PaymentLineDto;
  accountId: string | null;
  installments: number;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly receivablesService: ReceivablesService,
    private readonly paymentRepository: PaymentRepository,
    private readonly entryRepository: FinancialEntryRepository,
    private readonly cashSessionRepository: CashSessionRepository,
    private readonly methodConfigsService: PaymentMethodConfigsService,
    private readonly accountsService: FinancialAccountsService,
  ) {}

  async register(
    ownerId: string,
    userId: string,
    receivableId: string,
    dto: RegisterPaymentDto,
    permissoes: readonly Permission[] = [],
  ): Promise<ReceivableDetailDto> {
    const repetido = await this.pagamentoJaRegistrado(
      ownerId,
      receivableId,
      dto.idempotencyKey,
    );
    if (repetido) return repetido;

    const linhas = await this.resolverLinhas(ownerId, userId, dto.lines);
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (dto.paidAt) validarDataDoLancamento(paidAt, permissoes);
    const totalDasLinhas = somar(...dto.lines.map((linha) => linha.amount));

    try {
      await this.gravar(
        ownerId,
        userId,
        receivableId,
        dto,
        linhas,
        paidAt,
        totalDasLinhas,
      );
    } catch (erro) {
      if (
        dto.idempotencyKey &&
        violouIndice(erro, PAYMENT_IDEMPOTENCY_KEY_UNICA)
      ) {
        const vencedor = await this.pagamentoJaRegistrado(
          ownerId,
          receivableId,
          dto.idempotencyKey,
        );
        if (vencedor) return vencedor;
      }
      throw erro;
    }

    return this.receivablesService.findOne(ownerId, receivableId);
  }

  private async pagamentoJaRegistrado(
    ownerId: string,
    receivableId: string,
    idempotencyKey: string | undefined,
  ): Promise<ReceivableDetailDto | null> {
    if (!idempotencyKey) return null;
    const existente = await this.paymentRepository.findByIdempotencyKey(
      ownerId,
      idempotencyKey,
    );
    if (!existente) return null;
    if (existente.receivableId !== receivableId) {
      throw new ConflictException(CHAVE_DE_OUTRA_COBRANCA);
    }
    return this.receivablesService.findOne(ownerId, receivableId);
  }

  private async gravar(
    ownerId: string,
    userId: string,
    receivableId: string,
    dto: RegisterPaymentDto,
    linhas: LinhaResolvida[],
    paidAt: Date,
    totalDasLinhas: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const cobranca = await this.receivablesService.travar(
        ownerId,
        receivableId,
        manager,
      );
      this.receivablesService.assertNaoCancelada(cobranca);

      const pago = await this.paymentRepository.sumNetPaid(
        cobranca.id,
        manager,
      );
      const saldo = subtrair(cobranca.totalAmount, pago);
      if (compararValores(totalDasLinhas, saldo) > 0) {
        throw new BadRequestException(PAGAMENTO_ACIMA_DO_SALDO);
      }

      const sessao = await this.cashSessionRepository.lockOpenByUser(
        userId,
        ownerId,
        manager,
      );
      const temDinheiro = linhas.some(
        ({ linha }) => linha.method === PaymentMethod.CASH,
      );
      if (temDinheiro && !sessao) {
        throw new BadRequestException(DINHEIRO_SEM_CAIXA);
      }
      if (
        temDinheiro &&
        sessao &&
        paidAt.getTime() < new Date(sessao.openedAt).getTime()
      ) {
        throw new BadRequestException(DINHEIRO_ANTES_DA_ABERTURA);
      }

      let chave = dto.idempotencyKey ?? null;
      for (const { linha, accountId, installments } of linhas) {
        const emDinheiro = linha.method === PaymentMethod.CASH;
        const pagamento = await this.paymentRepository.insert(
          {
            ownerId,
            receivableId: cobranca.id,
            method: linha.method,
            amount: normalizarValor(linha.amount),
            refundedAmount: '0.00',
            paidAt,
            accountId: emDinheiro ? (sessao?.accountId ?? null) : accountId,
            cashSessionId: sessao?.id ?? null,
            receivedById: userId,
            createdById: userId,
            cardBrand: linha.cardBrand ? linha.cardBrand : null,
            installments,
            nsu: linha.nsu ? linha.nsu : null,
            authorizationCode: linha.authorizationCode
              ? linha.authorizationCode
              : null,
            notes: linha.notes ? linha.notes : null,
            idempotencyKey: chave,
          },
          manager,
        );
        chave = null;
        await this.entryRepository.insert(
          {
            ownerId,
            accountId: emDinheiro ? null : accountId,
            cashSessionId: emDinheiro ? (sessao?.id ?? null) : null,
            direction: FinancialEntryDirection.IN,
            kind: FinancialEntryKind.PAYMENT,
            amount: pagamento.amount,
            paymentId: pagamento.id,
            occurredAt: paidAt,
            description: `Recebimento em ${ROTULO_DA_FORMA_DE_PAGAMENTO[linha.method]}`,
            createdById: userId,
          },
          manager,
        );
      }

      await this.receivablesService.recalcularTotais(cobranca, manager);
    });
  }

  async findAll(
    ownerId: string,
    dto: FindPaymentsDto,
  ): Promise<PaymentListResponseDto> {
    const { page, limit, skip } = paginacao(dto);
    const filtros = {
      from: dto.from,
      to: dto.to,
      method: dto.method,
      accountId: dto.accountId,
    };
    const [[pagamentos, total], totais] = await Promise.all([
      this.paymentRepository.findPaged(ownerId, filtros, skip, limit),
      this.paymentRepository.sumFiltered(ownerId, filtros),
    ]);
    return {
      data: pagamentos.map((pagamento) => ({
        id: pagamento.id,
        receivableId: pagamento.receivableId,
        patient: referencia(pagamento.receivable?.patient) ?? {
          id: pagamento.receivable?.patientId ?? '',
          name: '',
        },
        method: pagamento.method,
        amount: normalizarValor(pagamento.amount),
        refundedAmount: normalizarValor(pagamento.refundedAmount),
        paidAt: pagamento.paidAt,
        account: referencia(pagamento.account),
        receivedBy: referencia(pagamento.receivedBy),
        installments: pagamento.installments,
        cardBrand: pagamento.cardBrand ?? null,
      })),
      total,
      page,
      limit,
      totalAmount: normalizarValor(totais.totalAmount),
      totalRefunded: normalizarValor(totais.totalRefunded),
    };
  }

  async findOwnedOrFail(ownerId: string, paymentId: string): Promise<Payment> {
    const pagamento = await this.paymentRepository.findOwnedWithDetails(
      paymentId,
      ownerId,
    );
    if (!pagamento) throw new NotFoundException(PAGAMENTO_NAO_ENCONTRADO);
    return pagamento;
  }

  private async resolverLinhas(
    ownerId: string,
    userId: string,
    linhas: PaymentLineDto[],
  ): Promise<LinhaResolvida[]> {
    const configuracoes = await this.methodConfigsService.list(ownerId, userId);
    const resolvidas: LinhaResolvida[] = [];
    for (const linha of linhas) {
      const rotulo = ROTULO_DA_FORMA_DE_PAGAMENTO[linha.method];
      if (!ehPositivo(linha.amount)) {
        throw new BadRequestException(VALOR_DA_LINHA_INVALIDO);
      }
      const configuracao = configuracoes.find((c) => c.method === linha.method);
      if (!configuracao || !configuracao.active) {
        throw new BadRequestException(
          `A forma de pagamento ${rotulo} está inativa`,
        );
      }
      const installments = linha.installments ?? 1;
      if (installments > 1 && linha.method !== PaymentMethod.CREDIT_CARD) {
        throw new BadRequestException(PARCELAS_SO_NO_CREDITO);
      }
      if (installments > configuracao.maxInstallments) {
        throw new BadRequestException(
          `${rotulo} aceita no máximo ${configuracao.maxInstallments} parcela(s)`,
        );
      }
      let accountId: string | null = null;
      if (linha.method !== PaymentMethod.CASH) {
        accountId = linha.accountId ?? configuracao.defaultAccountId;
        if (!accountId) {
          throw new BadRequestException(
            `Informe a conta de destino de ${rotulo} ou configure uma conta padrão`,
          );
        }
        await this.accountsService.findActiveOwnedOrFail(ownerId, accountId);
      }
      resolvidas.push({ linha, accountId, installments });
    }
    return resolvidas;
  }
}
