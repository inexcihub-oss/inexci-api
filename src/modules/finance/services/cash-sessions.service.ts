import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  CASH_SESSION_ABERTA_UNICA,
  CashSession,
} from 'src/database/entities/cash-session.entity';
import {
  FinancialEntryDirection,
  FinancialEntryKind,
} from 'src/database/entities/financial-entry.entity';
import { FinancialAccountType } from 'src/database/entities/financial-account.entity';
import {
  PAYMENT_METHODS,
  PaymentMethod,
} from 'src/database/entities/payment-method-config.entity';
import { CashSessionRepository } from 'src/database/repositories/cash-session.repository';
import { FinancialEntryRepository } from 'src/database/repositories/financial-entry.repository';
import { PaymentRepository } from 'src/database/repositories/payment.repository';
import { RefundRepository } from 'src/database/repositories/refund.repository';
import { violouIndice } from 'src/database/repositories/unique-violation.util';
import { Permission } from 'src/shared/permissions';
import { AuthenticatedUser } from 'src/shared/decorators/current-user.decorator';
import { paginacao } from '../dto/finance-common.dto';
import {
  CashMovementDto,
  CashSessionListItemDto,
  CashSessionListResponseDto,
  CashSessionSummaryDto,
  CashTotalByMethodDto,
  CloseCashSessionDto,
  CurrentCashSessionDto,
  FindCashSessionsDto,
  OpenCashSessionDto,
} from '../dto/cash-session.dto';
import { referencia } from '../mappers/receivable.mapper';
import { CelulaCsv, gerarCsv, valorCsv } from '../utils/csv';
import { dataHoraEmSaoPaulo } from '../utils/datas';
import {
  compararValores,
  ehPositivo,
  normalizarValor,
  paraCentavos,
  subtrair,
} from '../utils/dinheiro';
import { ownerIdDe } from '../utils/owner';
import {
  ROTULO_DA_DIRECAO,
  ROTULO_DA_FORMA_DE_PAGAMENTO,
  ROTULO_DO_LANCAMENTO,
} from '../utils/rotulos-financeiros';
import { FinancialAccountsService } from './financial-accounts.service';

export const CAIXA_JA_ABERTO = 'Você já tem um caixa aberto';
export const CAIXA_NAO_ENCONTRADO = 'Caixa não encontrado';
export const SEM_CAIXA_ABERTO = 'Você não tem um caixa aberto';
export const CAIXA_JA_FECHADO = 'O caixa já está fechado';
export const CONTA_NAO_E_CAIXA =
  'A conta do caixa precisa ser do tipo caixa físico';
export const RETIRADA_ACIMA_DO_SALDO =
  'A retirada passa do saldo em dinheiro do caixa';
export const VALOR_DO_MOVIMENTO_INVALIDO = 'O valor deve ser maior que zero';
export const FECHAR_CAIXA_ALHEIO =
  'Só quem administra a conta pode fechar o caixa de outro usuário';
export const VER_CAIXA_ALHEIO =
  'Só quem administra a conta pode ver o caixa de outro usuário';
export const JUSTIFICATIVA_OBRIGATORIA =
  'Diferença acima de R$ 50,00 no fechamento: informe a justificativa';
export const DIFERENCA_EXIGE_ADMINISTRACAO =
  'Diferença acima de R$ 1.000,00 no fechamento: só quem administra a conta pode fechar';

export const DIFERENCA_QUE_EXIGE_JUSTIFICATIVA_CENTAVOS = 5_000;
export const DIFERENCA_QUE_EXIGE_ADMINISTRACAO_CENTAVOS = 100_000;

function administra(user: Pick<AuthenticatedUser, 'permissions'>): boolean {
  return (user.permissions ?? []).includes(Permission.ADMINISTRACAO);
}

@Injectable()
export class CashSessionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cashSessionRepository: CashSessionRepository,
    private readonly entryRepository: FinancialEntryRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly refundRepository: RefundRepository,
    private readonly accountsService: FinancialAccountsService,
  ) {}

  async current(
    ownerId: string,
    userId: string,
  ): Promise<CurrentCashSessionDto> {
    const sessao = await this.cashSessionRepository.findOpenByUser(
      userId,
      ownerId,
    );
    return { session: sessao ? await this.summary(ownerId, sessao.id) : null };
  }

  async open(
    ownerId: string,
    userId: string,
    dto: OpenCashSessionDto,
  ): Promise<CashSessionSummaryDto> {
    const conta = await this.accountsService.findActiveOwnedOrFail(
      ownerId,
      dto.accountId,
    );
    if (conta.type !== FinancialAccountType.CASH_DRAWER) {
      throw new BadRequestException(CONTA_NAO_E_CAIXA);
    }
    if (await this.cashSessionRepository.findOpenByUser(userId, ownerId)) {
      throw new ConflictException(CAIXA_JA_ABERTO);
    }
    const abertura = normalizarValor(dto.openingAmount);

    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const agora = new Date();
        const sessao = await this.cashSessionRepository.insert(
          {
            ownerId,
            userId,
            accountId: conta.id,
            openedAt: agora,
            openingAmount: abertura,
            createdById: userId,
          },
          manager,
        );
        if (ehPositivo(abertura)) {
          await this.entryRepository.insert(
            {
              ownerId,
              cashSessionId: sessao.id,
              accountId: null,
              direction: FinancialEntryDirection.IN,
              kind: FinancialEntryKind.SUPPLY,
              amount: abertura,
              occurredAt: agora,
              description: 'Abertura de caixa',
              createdById: userId,
            },
            manager,
          );
        }
        return sessao.id;
      });
      return this.summary(ownerId, id);
    } catch (erro) {
      if (violouIndice(erro, CASH_SESSION_ABERTA_UNICA)) {
        throw new ConflictException(CAIXA_JA_ABERTO);
      }
      throw erro;
    }
  }

  withdraw(
    ownerId: string,
    userId: string,
    dto: CashMovementDto,
  ): Promise<CashSessionSummaryDto> {
    return this.movimentar(ownerId, userId, dto, FinancialEntryKind.WITHDRAWAL);
  }

  supply(
    ownerId: string,
    userId: string,
    dto: CashMovementDto,
  ): Promise<CashSessionSummaryDto> {
    return this.movimentar(ownerId, userId, dto, FinancialEntryKind.SUPPLY);
  }

  async closeCurrent(
    user: AuthenticatedUser,
    dto: CloseCashSessionDto,
  ): Promise<CashSessionSummaryDto> {
    const ownerId = ownerIdDe(user);
    const sessao = await this.cashSessionRepository.findOpenByUser(
      user.userId,
      ownerId,
    );
    if (!sessao) throw new BadRequestException(SEM_CAIXA_ABERTO);
    return this.close(user, sessao.id, dto);
  }

  async close(
    user: AuthenticatedUser,
    sessionId: string,
    dto: CloseCashSessionDto,
  ): Promise<CashSessionSummaryDto> {
    const ownerId = ownerIdDe(user);
    const contado = normalizarValor(dto.countedAmount);

    await this.dataSource.transaction(async (manager) => {
      const sessao = await this.cashSessionRepository.lockOwned(
        sessionId,
        ownerId,
        manager,
      );
      if (!sessao) throw new NotFoundException(CAIXA_NAO_ENCONTRADO);
      if (sessao.userId !== user.userId && !administra(user)) {
        throw new ForbiddenException(FECHAR_CAIXA_ALHEIO);
      }
      if (sessao.closedAt) throw new BadRequestException(CAIXA_JA_FECHADO);

      const esperado = normalizarValor(
        await this.entryRepository.cashSessionBalance(sessao.id, manager),
      );
      const diferenca = Math.abs(paraCentavos(subtrair(contado, esperado)));
      if (
        diferenca > DIFERENCA_QUE_EXIGE_ADMINISTRACAO_CENTAVOS &&
        !administra(user)
      ) {
        throw new ForbiddenException(DIFERENCA_EXIGE_ADMINISTRACAO);
      }
      if (
        diferenca > DIFERENCA_QUE_EXIGE_JUSTIFICATIVA_CENTAVOS &&
        !dto.notes?.trim()
      ) {
        throw new BadRequestException(JUSTIFICATIVA_OBRIGATORIA);
      }
      const agora = new Date();

      if (ehPositivo(contado)) {
        await this.transferirFechamento(sessao, contado, agora, user, manager);
      }

      sessao.closedAt = agora;
      sessao.closedById = user.userId;
      sessao.countedAmount = contado;
      sessao.expectedAmount = esperado;
      sessao.difference = subtrair(contado, esperado);
      sessao.notes = dto.notes ? dto.notes : sessao.notes;
      await this.cashSessionRepository.save(sessao, manager);
    });

    return this.summary(ownerId, sessionId);
  }

  async list(
    user: AuthenticatedUser,
    dto: FindCashSessionsDto,
  ): Promise<CashSessionListResponseDto> {
    const ownerId = ownerIdDe(user);
    if (!administra(user) && dto.userId && dto.userId !== user.userId) {
      throw new ForbiddenException(VER_CAIXA_ALHEIO);
    }
    const userId = administra(user) ? dto.userId : user.userId;
    const { page, limit, skip } = paginacao(dto);
    const [sessoes, total] = await this.cashSessionRepository.findPaged(
      ownerId,
      { userId, from: dto.from, to: dto.to },
      skip,
      limit,
    );
    return {
      data: sessoes.map((sessao) => this.paraItemDaLista(sessao)),
      total,
      page,
      limit,
    };
  }

  async summary(
    ownerId: string,
    sessionId: string,
  ): Promise<CashSessionSummaryDto> {
    const sessao = await this.cashSessionRepository.findOwnedWithPeople(
      sessionId,
      ownerId,
    );
    if (!sessao) throw new NotFoundException(CAIXA_NAO_ENCONTRADO);

    const [lancamentos, saldo, recebidos, estornados] = await Promise.all([
      this.entryRepository.findByCashSession(sessao.id),
      this.entryRepository.cashSessionBalance(sessao.id),
      this.paymentRepository.receivedByMethodForSession(sessao.id),
      this.refundRepository.refundedByMethodForSession(sessao.id),
    ]);

    return {
      ...this.paraItemDaLista(sessao),
      cashBalance: normalizarValor(saldo),
      notes: sessao.notes ?? null,
      closedBy: referencia(sessao.closedBy),
      totalsByMethod: this.totaisPorForma(recebidos, estornados),
      entries: lancamentos.map((lancamento) => ({
        id: lancamento.id,
        direction: lancamento.direction,
        kind: lancamento.kind,
        amount: normalizarValor(lancamento.amount),
        occurredAt: lancamento.occurredAt,
        description: lancamento.description ?? null,
        paymentId: lancamento.paymentId ?? null,
        refundId: lancamento.refundId ?? null,
      })),
    };
  }

  async summaryFor(
    user: AuthenticatedUser,
    sessionId: string,
  ): Promise<CashSessionSummaryDto> {
    const ownerId = ownerIdDe(user);
    if (!administra(user)) {
      const sessao = await this.cashSessionRepository.findOwnedWithPeople(
        sessionId,
        ownerId,
      );
      if (!sessao) throw new NotFoundException(CAIXA_NAO_ENCONTRADO);
      if (sessao.userId !== user.userId) {
        throw new ForbiddenException(VER_CAIXA_ALHEIO);
      }
    }
    return this.summary(ownerId, sessionId);
  }

  async reportCsv(user: AuthenticatedUser, sessionId: string): Promise<string> {
    const resumo = await this.summaryFor(user, sessionId);
    const linhaDeResumo = (
      tipo: string,
      descricao: string,
      valor: string | null,
      data: Date | null = null,
    ): CelulaCsv[] => [
      'Resumo',
      data ? dataHoraEmSaoPaulo(data) : '',
      tipo,
      descricao,
      '',
      '',
      valor === null ? '' : valorCsv(valor),
    ];
    const linhas: CelulaCsv[][] = [
      linhaDeResumo('Operador', resumo.user.name, null),
      linhaDeResumo('Conta do caixa', resumo.account.name, null),
      linhaDeResumo('Abertura', '', resumo.openingAmount, resumo.openedAt),
      linhaDeResumo('Saldo em dinheiro', '', resumo.cashBalance),
    ];
    if (resumo.closedAt) {
      linhas.push(
        linhaDeResumo(
          'Esperado no fechamento',
          '',
          resumo.expectedAmount,
          resumo.closedAt,
        ),
        linhaDeResumo('Contado', '', resumo.countedAmount),
        linhaDeResumo('Diferença', '', resumo.difference),
      );
    }
    resumo.entries.forEach((lancamento) => {
      const entrada = lancamento.direction === FinancialEntryDirection.IN;
      linhas.push([
        'Movimento',
        dataHoraEmSaoPaulo(lancamento.occurredAt),
        `${ROTULO_DO_LANCAMENTO[lancamento.kind]} (${ROTULO_DA_DIRECAO[lancamento.direction]})`,
        lancamento.description ?? '',
        entrada ? valorCsv(lancamento.amount) : '',
        entrada ? '' : valorCsv(lancamento.amount),
        '',
      ]);
    });
    resumo.totalsByMethod.forEach((total) => {
      linhas.push([
        'Total por forma',
        '',
        ROTULO_DA_FORMA_DE_PAGAMENTO[total.method],
        '',
        valorCsv(total.received),
        valorCsv(total.refunded),
        valorCsv(total.net),
      ]);
    });
    return gerarCsv(
      [
        'Seção',
        'Data/hora',
        'Tipo',
        'Descrição',
        'Entrada/Recebido',
        'Saída/Estornado',
        'Valor/Líquido',
      ],
      linhas,
    );
  }

  private async movimentar(
    ownerId: string,
    userId: string,
    dto: CashMovementDto,
    kind: FinancialEntryKind.WITHDRAWAL | FinancialEntryKind.SUPPLY,
  ): Promise<CashSessionSummaryDto> {
    if (!ehPositivo(dto.amount)) {
      throw new BadRequestException(VALOR_DO_MOVIMENTO_INVALIDO);
    }
    const valor = normalizarValor(dto.amount);
    const id = await this.dataSource.transaction(async (manager) => {
      const sessao = await this.cashSessionRepository.lockOpenByUser(
        userId,
        ownerId,
        manager,
      );
      if (!sessao) throw new BadRequestException(SEM_CAIXA_ABERTO);
      const retirada = kind === FinancialEntryKind.WITHDRAWAL;
      if (retirada) {
        const saldo = await this.entryRepository.cashSessionBalance(
          sessao.id,
          manager,
        );
        if (compararValores(valor, saldo) > 0) {
          throw new BadRequestException(RETIRADA_ACIMA_DO_SALDO);
        }
      }
      await this.entryRepository.insert(
        {
          ownerId,
          cashSessionId: sessao.id,
          accountId: null,
          direction: retirada
            ? FinancialEntryDirection.OUT
            : FinancialEntryDirection.IN,
          kind,
          amount: valor,
          occurredAt: new Date(),
          description: dto.description,
          createdById: userId,
        },
        manager,
      );
      return sessao.id;
    });
    return this.summary(ownerId, id);
  }

  private async transferirFechamento(
    sessao: CashSession,
    contado: string,
    agora: Date,
    user: AuthenticatedUser,
    manager: EntityManager,
  ): Promise<void> {
    const saida = await this.entryRepository.insert(
      {
        ownerId: sessao.ownerId,
        cashSessionId: sessao.id,
        accountId: null,
        direction: FinancialEntryDirection.OUT,
        kind: FinancialEntryKind.SESSION_CLOSING,
        amount: contado,
        occurredAt: agora,
        description: 'Fechamento de caixa',
        createdById: user.userId,
      },
      manager,
    );
    const entrada = await this.entryRepository.insert(
      {
        ownerId: sessao.ownerId,
        accountId: sessao.accountId,
        cashSessionId: null,
        direction: FinancialEntryDirection.IN,
        kind: FinancialEntryKind.SESSION_CLOSING,
        amount: contado,
        occurredAt: agora,
        description: 'Fechamento de caixa',
        counterpartEntryId: saida.id,
        createdById: user.userId,
      },
      manager,
    );
    await this.entryRepository.linkCounterpart(saida.id, entrada.id, manager);
  }

  private totaisPorForma(
    recebidos: { method: PaymentMethod; received: string }[],
    estornados: { method: PaymentMethod; refunded: string }[],
  ): CashTotalByMethodDto[] {
    return PAYMENT_METHODS.map((method) => {
      const received = normalizarValor(
        recebidos.find((r) => r.method === method)?.received,
      );
      const refunded = normalizarValor(
        estornados.find((e) => e.method === method)?.refunded,
      );
      return { method, received, refunded, net: subtrair(received, refunded) };
    }).filter(
      (total) =>
        paraCentavos(total.received) !== 0 ||
        paraCentavos(total.refunded) !== 0,
    );
  }

  private paraItemDaLista(sessao: CashSession): CashSessionListItemDto {
    return {
      id: sessao.id,
      user: referencia(sessao.user) ?? { id: sessao.userId, name: '' },
      account: referencia(sessao.account) ?? {
        id: sessao.accountId,
        name: '',
      },
      openedAt: sessao.openedAt,
      closedAt: sessao.closedAt ?? null,
      openingAmount: normalizarValor(sessao.openingAmount),
      expectedAmount:
        sessao.expectedAmount === null || sessao.expectedAmount === undefined
          ? null
          : normalizarValor(sessao.expectedAmount),
      countedAmount:
        sessao.countedAmount === null || sessao.countedAmount === undefined
          ? null
          : normalizarValor(sessao.countedAmount),
      difference:
        sessao.difference === null || sessao.difference === undefined
          ? null
          : normalizarValor(sessao.difference),
    };
  }
}
