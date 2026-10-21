import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  FinancialEntryDirection,
  FinancialEntryKind,
} from 'src/database/entities/financial-entry.entity';
import { PaymentMethod } from 'src/database/entities/payment-method-config.entity';
import { REFUND_REASON_LABELS } from 'src/database/entities/refund.entity';
import { CashSessionRepository } from 'src/database/repositories/cash-session.repository';
import { FinancialEntryRepository } from 'src/database/repositories/financial-entry.repository';
import { PaymentRepository } from 'src/database/repositories/payment.repository';
import { RefundRepository } from 'src/database/repositories/refund.repository';
import { CreateRefundDto } from '../dto/payment.dto';
import { ReceivableDetailDto } from '../dto/receivable.dto';
import {
  compararValores,
  ehPositivo,
  normalizarValor,
  subtrair,
} from '../utils/dinheiro';
import { PAGAMENTO_NAO_ENCONTRADO } from './payments.service';
import { ReceivablesService } from './receivables.service';

export const ESTORNO_ACIMA_DO_PAGO =
  'O valor do estorno passa do que ainda pode ser estornado deste pagamento';
export const ESTORNO_EM_DINHEIRO_SEM_CAIXA =
  'Abra o caixa para estornar em dinheiro';
export const ESTORNO_SEM_SALDO_NO_CAIXA =
  'O caixa não tem dinheiro suficiente para este estorno';
export const ESTORNO_SEM_CONTA =
  'O pagamento não tem conta de destino para o estorno';
export const VALOR_DO_ESTORNO_INVALIDO =
  'O valor do estorno deve ser maior que zero';

@Injectable()
export class RefundsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly receivablesService: ReceivablesService,
    private readonly paymentRepository: PaymentRepository,
    private readonly refundRepository: RefundRepository,
    private readonly entryRepository: FinancialEntryRepository,
    private readonly cashSessionRepository: CashSessionRepository,
  ) {}

  async refund(
    ownerId: string,
    userId: string,
    paymentId: string,
    dto: CreateRefundDto,
  ): Promise<ReceivableDetailDto> {
    if (!ehPositivo(dto.amount)) {
      throw new BadRequestException(VALOR_DO_ESTORNO_INVALIDO);
    }
    const valor = normalizarValor(dto.amount);

    const receivableId = await this.dataSource.transaction(async (manager) => {
      const pagamento = await this.paymentRepository.lockOwned(
        paymentId,
        ownerId,
        manager,
      );
      if (!pagamento) throw new NotFoundException(PAGAMENTO_NAO_ENCONTRADO);
      const cobranca = await this.receivablesService.travar(
        ownerId,
        pagamento.receivableId,
        manager,
      );

      const disponivel = subtrair(pagamento.amount, pagamento.refundedAmount);
      if (compararValores(valor, disponivel) > 0) {
        throw new BadRequestException(ESTORNO_ACIMA_DO_PAGO);
      }

      const emDinheiro = pagamento.method === PaymentMethod.CASH;
      const sessao = await this.cashSessionRepository.lockOpenByUser(
        userId,
        ownerId,
        manager,
      );
      if (emDinheiro) {
        if (!sessao) {
          throw new BadRequestException(ESTORNO_EM_DINHEIRO_SEM_CAIXA);
        }
        const saldo = await this.entryRepository.cashSessionBalance(
          sessao.id,
          manager,
        );
        if (compararValores(valor, saldo) > 0) {
          throw new BadRequestException(ESTORNO_SEM_SALDO_NO_CAIXA);
        }
      } else if (!pagamento.accountId) {
        throw new BadRequestException(ESTORNO_SEM_CONTA);
      }

      const estorno = await this.refundRepository.insert(
        {
          ownerId,
          paymentId: pagamento.id,
          amount: valor,
          reason: dto.reason,
          notes: dto.notes ? dto.notes : null,
          accountId: emDinheiro ? null : pagamento.accountId,
          cashSessionId: sessao?.id ?? null,
          refundedById: userId,
          createdById: userId,
        },
        manager,
      );
      await this.entryRepository.insert(
        {
          ownerId,
          accountId: emDinheiro ? null : pagamento.accountId,
          cashSessionId: emDinheiro ? (sessao?.id ?? null) : null,
          direction: FinancialEntryDirection.OUT,
          kind: FinancialEntryKind.REFUND,
          amount: valor,
          paymentId: pagamento.id,
          refundId: estorno.id,
          occurredAt: new Date(),
          description: `Estorno: ${REFUND_REASON_LABELS[dto.reason]}`,
          createdById: userId,
        },
        manager,
      );
      await this.paymentRepository.addRefunded(pagamento.id, valor, manager);
      await this.receivablesService.recalcularTotais(cobranca, manager);
      return cobranca.id;
    });

    return this.receivablesService.findOne(ownerId, receivableId);
  }
}
