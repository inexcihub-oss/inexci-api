/* eslint-disable @typescript-eslint/require-await */
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  Appointment,
  AppointmentStatus,
  AppointmentType,
} from 'src/database/entities/appointment.entity';
import {
  CASH_SESSION_ABERTA_UNICA,
  CashSession,
} from 'src/database/entities/cash-session.entity';
import {
  FinancialAccount,
  FinancialAccountType,
} from 'src/database/entities/financial-account.entity';
import {
  FinancialEntry,
  FinancialEntryDirection,
} from 'src/database/entities/financial-entry.entity';
import {
  PaymentMethod,
  PAYMENT_METHODS,
} from 'src/database/entities/payment-method-config.entity';
import {
  PAYMENT_IDEMPOTENCY_KEY_UNICA,
  Payment,
} from 'src/database/entities/payment.entity';
import { ReceivableItem } from 'src/database/entities/receivable-item.entity';
import {
  RECEIVABLE_ATIVA_POR_CONSULTA,
  Receivable,
  ReceivableStatus,
} from 'src/database/entities/receivable.entity';
import { Refund } from 'src/database/entities/refund.entity';
import { AppointmentRepository } from 'src/database/repositories/appointment.repository';
import { CashSessionRepository } from 'src/database/repositories/cash-session.repository';
import { FinancialAccountRepository } from 'src/database/repositories/financial-account.repository';
import { FinancialEntryRepository } from 'src/database/repositories/financial-entry.repository';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { PaymentRepository } from 'src/database/repositories/payment.repository';
import { ReceivableItemRepository } from 'src/database/repositories/receivable-item.repository';
import { ReceivableRepository } from 'src/database/repositories/receivable.repository';
import { RefundRepository } from 'src/database/repositories/refund.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { PaymentMethodConfigDto } from '../dto/payment-method-config.dto';
import {
  compararValores,
  multiplicar,
  somar,
  subtrair,
} from '../utils/dinheiro';
import { CashSessionsService } from './cash-sessions.service';
import { FinancialAccountsService } from './financial-accounts.service';
import { PaymentMethodConfigsService } from './payment-method-configs.service';
import { PaymentsService } from './payments.service';
import { ReceivablesService } from './receivables.service';
import { RefundsService } from './refunds.service';
import { TransfersService } from './transfers.service';

export const OWNER = '00000000-0000-4000-8000-000000000001';
export const OUTRO_OWNER = '00000000-0000-4000-8000-000000000002';
export const RECEPCAO = '00000000-0000-4000-8000-000000000010';
export const MEDICO = '00000000-0000-4000-8000-000000000011';
export const SECRETARIA = '00000000-0000-4000-8000-000000000012';
export const MEDICO_DE_FORA = '00000000-0000-4000-8000-000000000013';
export const PSICOLOGA = '00000000-0000-4000-8000-000000000014';
export const PACIENTE = '00000000-0000-4000-8000-000000000020';
export const PACIENTE_DE_FORA = '00000000-0000-4000-8000-000000000021';
export const CONSULTA = '00000000-0000-4000-8000-000000000030';
export const CONSULTA_CONVENIO = '00000000-0000-4000-8000-000000000031';
export const CONSULTA_DE_FORA = '00000000-0000-4000-8000-000000000032';
export const CONSULTA_SEM_PRECO = '00000000-0000-4000-8000-000000000033';
export const CONSULTA_CANCELADA = '00000000-0000-4000-8000-000000000034';
export const CONSULTA_FALTOU = '00000000-0000-4000-8000-000000000035';
export const CONTA_CAIXA = '00000000-0000-4000-8000-000000000040';
export const CONTA_BANCO = '00000000-0000-4000-8000-000000000041';
export const CONTA_STONE = '00000000-0000-4000-8000-000000000042';
export const CONTA_DE_FORA = '00000000-0000-4000-8000-000000000043';

interface Manager {
  liberar: (() => void)[];
}

function violacao(constraint: string): Error {
  return Object.assign(new Error(`duplicate key ${constraint}`), {
    code: '23505',
    constraint,
  });
}

function proximoTique(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export class BancoFalso {
  cobrancas: Receivable[] = [];
  itens: ReceivableItem[] = [];
  pagamentos: Payment[] = [];
  estornos: Refund[] = [];
  lancamentos: FinancialEntry[] = [];
  caixas: CashSession[] = [];
  contas: FinancialAccount[] = [];
  pacientes: { id: string; ownerId: string; name: string }[] = [];
  consultas: Appointment[] = [];
  usuarios: {
    id: string;
    ownerId: string;
    name: string;
    doctorProfile: object | null;
  }[] = [];
  configuracoes: PaymentMethodConfigDto[] = [];
  travasAtivas = 0;
  private travas = new Map<string, Promise<void>>();

  constructor() {
    this.usuarios.push(
      { id: RECEPCAO, ownerId: OWNER, name: 'Recepção', doctorProfile: null },
      {
        id: MEDICO,
        ownerId: OWNER,
        name: 'Dr. Fabio',
        doctorProfile: { council: 'CRM', crm: '12345', crmState: 'SP' },
      },
      {
        id: PSICOLOGA,
        ownerId: OWNER,
        name: 'Psicóloga Ana',
        doctorProfile: { council: 'CRP', crm: null, crmState: null },
      },
      {
        id: SECRETARIA,
        ownerId: OWNER,
        name: 'Secretária',
        doctorProfile: null,
      },
      {
        id: MEDICO_DE_FORA,
        ownerId: OUTRO_OWNER,
        name: 'Dr. Outro',
        doctorProfile: {},
      },
    );
    this.pacientes.push(
      { id: PACIENTE, ownerId: OWNER, name: 'Maria' },
      { id: PACIENTE_DE_FORA, ownerId: OUTRO_OWNER, name: 'José' },
    );
    this.consultas.push(
      this.consulta(CONSULTA, OWNER, PACIENTE, '350.00', null),
      this.consulta(CONSULTA_CONVENIO, OWNER, PACIENTE, null, 'plano-1'),
      this.consulta(CONSULTA_DE_FORA, OUTRO_OWNER, PACIENTE_DE_FORA, '100.00'),
      this.consulta(CONSULTA_SEM_PRECO, OWNER, PACIENTE, null),
      this.consulta(
        CONSULTA_CANCELADA,
        OWNER,
        PACIENTE,
        '350.00',
        null,
        AppointmentStatus.CANCELLED,
      ),
      this.consulta(
        CONSULTA_FALTOU,
        OWNER,
        PACIENTE,
        '350.00',
        null,
        AppointmentStatus.NO_SHOW,
      ),
    );
    this.contas.push(
      this.conta(CONTA_CAIXA, OWNER, FinancialAccountType.CASH_DRAWER),
      this.conta(CONTA_BANCO, OWNER, FinancialAccountType.BANK),
      this.conta(CONTA_STONE, OWNER, FinancialAccountType.CARD_CREDIT),
      this.conta(CONTA_DE_FORA, OUTRO_OWNER, FinancialAccountType.BANK),
    );
    this.configuracoes = PAYMENT_METHODS.map((method) => ({
      method,
      active: method !== PaymentMethod.BOLETO,
      defaultAccountId:
        method === PaymentMethod.PIX
          ? CONTA_BANCO
          : method === PaymentMethod.CREDIT_CARD ||
              method === PaymentMethod.DEBIT_CARD
            ? CONTA_STONE
            : null,
      defaultAccount: null,
      maxInstallments: method === PaymentMethod.CREDIT_CARD ? 6 : 1,
    }));
  }

  private consulta(
    id: string,
    ownerId: string,
    patientId: string,
    price: string | null,
    healthPlanId: string | null = null,
    status: AppointmentStatus = AppointmentStatus.COMPLETED,
  ): Appointment {
    return {
      id,
      ownerId,
      patientId,
      doctorId: ownerId === OWNER ? MEDICO : MEDICO_DE_FORA,
      type: AppointmentType.FIRST_VISIT,
      scheduledAt: new Date('2026-10-20T13:00:00.000Z'),
      price,
      healthPlanId,
      status,
    } as Appointment;
  }

  private conta(
    id: string,
    ownerId: string,
    type: FinancialAccountType,
  ): FinancialAccount {
    return {
      id,
      ownerId,
      type,
      name: `Conta ${type}`,
      active: true,
      notes: null,
      createdAt: new Date(),
    } as FinancialAccount;
  }

  dataSource(): DataSource {
    return {
      transaction: async <T>(cb: (manager: Manager) => Promise<T>) => {
        const manager: Manager = { liberar: [] };
        try {
          await proximoTique();
          return await cb(manager);
        } finally {
          manager.liberar.forEach((liberar) => liberar());
        }
      },
    } as unknown as DataSource;
  }

  private async travar(chave: string, manager: Manager): Promise<void> {
    while (this.travas.has(chave)) {
      await this.travas.get(chave);
    }
    let liberar: () => void = () => undefined;
    const trava = new Promise<void>((resolve) => {
      liberar = () => {
        this.travas.delete(chave);
        this.travasAtivas -= 1;
        resolve();
      };
    });
    this.travasAtivas += 1;
    this.travas.set(chave, trava);
    manager.liberar.push(liberar);
    await proximoTique();
  }

  private nomeDe(id: string | null): { id: string; name: string } | null {
    const usuario = this.usuarios.find((u) => u.id === id);
    return usuario ? { id: usuario.id, name: usuario.name } : null;
  }

  private totalDoItem(item: ReceivableItem): string {
    return subtrair(
      somar(multiplicar(item.unitAmount, item.quantity), item.surcharge),
      item.discount,
    );
  }

  receivableRepository(): ReceivableRepository {
    const repo = {
      insert: async (dados: Partial<Receivable>) => {
        await proximoTique();
        if (
          dados.appointmentId &&
          this.cobrancas.some(
            (c) =>
              c.appointmentId === dados.appointmentId &&
              c.status !== ReceivableStatus.CANCELLED,
          )
        ) {
          throw violacao(RECEIVABLE_ATIVA_POR_CONSULTA);
        }
        const cobranca = {
          id: randomUUID(),
          cancelledAt: null,
          cancelledById: null,
          cancelReason: null,
          createdAt: new Date(),
          ...dados,
        } as Receivable;
        this.cobrancas.push(cobranca);
        return { ...cobranca };
      },
      findOwned: async (id: string, ownerId: string) => {
        await proximoTique();
        const c = this.cobrancas.find(
          (x) => x.id === id && x.ownerId === ownerId,
        );
        return c ? { ...c } : null;
      },
      lockOwned: async (id: string, ownerId: string, manager: Manager) => {
        await this.travar(`receivable:${id}`, manager);
        const c = this.cobrancas.find(
          (x) => x.id === id && x.ownerId === ownerId,
        );
        return c ? { ...c } : null;
      },
      updateTotals: async (
        id: string,
        totais: Pick<Receivable, 'totalAmount' | 'paidAmount' | 'status'>,
      ) => {
        await proximoTique();
        Object.assign(
          this.cobrancas.find((c) => c.id === id) as Receivable,
          totais,
        );
      },
      markCancelled: async (
        id: string,
        dados: Pick<
          Receivable,
          'cancelledById' | 'cancelReason' | 'cancelledAt'
        >,
      ) => {
        Object.assign(this.cobrancas.find((c) => c.id === id) as Receivable, {
          ...dados,
          status: ReceivableStatus.CANCELLED,
        });
      },
      findDetail: async (id: string, ownerId: string) => {
        await proximoTique();
        const c = this.cobrancas.find(
          (x) => x.id === id && x.ownerId === ownerId,
        );
        return c ? this.detalhe(c) : null;
      },
      findPaged: async (
        ownerId: string,
        filtros: { status?: ReceivableStatus; patientId?: string },
        skip: number,
        take: number,
      ) => {
        const lista = this.filtrar(ownerId, filtros);
        return [
          lista.slice(skip, skip + take).map((c) => this.comPaciente(c)),
          lista.length,
        ];
      },
      sumOpenBalance: async (
        ownerId: string,
        filtros: { status?: ReceivableStatus; patientId?: string },
      ) =>
        somar(
          ...this.filtrar(ownerId, filtros)
            .filter(
              (c) =>
                c.status === ReceivableStatus.OPEN ||
                c.status === ReceivableStatus.PARTIAL,
            )
            .map((c) => subtrair(c.totalAmount, c.paidAmount)),
        ),
      findByPatient: async (ownerId: string, patientId: string) =>
        this.filtrar(ownerId, { patientId }).map((c) => this.comPaciente(c)),
      findActiveByAppointments: async (ownerId: string, ids: string[]) =>
        this.cobrancas
          .filter(
            (c) =>
              c.ownerId === ownerId &&
              c.appointmentId &&
              ids.includes(c.appointmentId) &&
              c.status !== ReceivableStatus.CANCELLED,
          )
          .map((c) => ({
            appointmentId: c.appointmentId,
            receivableId: c.id,
            status: c.status,
          })),
    };
    return repo as unknown as ReceivableRepository;
  }

  private filtrar(
    ownerId: string,
    filtros: { status?: ReceivableStatus; patientId?: string },
  ): Receivable[] {
    return this.cobrancas.filter(
      (c) =>
        c.ownerId === ownerId &&
        (!filtros.status || c.status === filtros.status) &&
        (!filtros.patientId || c.patientId === filtros.patientId),
    );
  }

  private comPaciente(c: Receivable): Receivable {
    const paciente = this.pacientes.find((p) => p.id === c.patientId);
    return { ...c, patient: paciente } as unknown as Receivable;
  }

  private detalhe(c: Receivable): Receivable {
    return {
      ...this.comPaciente(c),
      createdBy: this.nomeDe(c.createdById),
      cancelledBy: this.nomeDe(c.cancelledById),
      items: this.itens
        .filter((i) => i.receivableId === c.id)
        .map((i) => ({ ...i, executedBy: this.nomeDe(i.executedById) })),
      payments: this.pagamentos
        .filter((p) => p.receivableId === c.id)
        .map((p) => ({
          ...p,
          account:
            this.contas.find((conta) => conta.id === p.accountId) ?? null,
          receivedBy: this.nomeDe(p.receivedById),
          refunds: this.estornos
            .filter((e) => e.paymentId === p.id)
            .map((e) => ({ ...e, refundedBy: this.nomeDe(e.refundedById) })),
        })),
    } as unknown as Receivable;
  }

  itemRepository(): ReceivableItemRepository {
    const ativos = (receivableId: string, exceto?: string) =>
      this.itens.filter(
        (i) =>
          i.receivableId === receivableId && !i.cancelledAt && i.id !== exceto,
      );
    const repo = {
      insertMany: async (itens: Partial<ReceivableItem>[]) => {
        await proximoTique();
        itens.forEach((dados) => {
          const item = {
            id: randomUUID(),
            cancelledAt: null,
            createdAt: new Date(),
            ...dados,
          } as ReceivableItem;
          if (item.total === undefined || item.total === null) {
            throw new Error('O total do item precisa ser gravado pelo serviço');
          }
          if (item.total !== this.totalDoItem(item)) {
            throw new Error('Total do item divergente');
          }
          this.itens.push(item);
        });
      },
      findActiveOfReceivable: async (itemId: string, receivableId: string) =>
        ativos(receivableId).find((i) => i.id === itemId) ?? null,
      countActive: async (receivableId: string) => ativos(receivableId).length,
      sumActiveTotal: async (
        receivableId: string,
        _m: Manager,
        exceto?: string,
      ) => {
        await proximoTique();
        return somar(...ativos(receivableId, exceto).map((i) => i.total));
      },
      markCancelled: async (itemId: string, cancelledById: string) => {
        Object.assign(
          this.itens.find((i) => i.id === itemId) as ReceivableItem,
          {
            cancelledAt: new Date(),
            cancelledById,
          },
        );
      },
      activeDescriptions: async (ids: string[]) =>
        new Map(
          ids.map((id) => [
            id,
            ativos(id)
              .map((i) => i.description)
              .join(', '),
          ]),
        ),
    };
    return repo as unknown as ReceivableItemRepository;
  }

  paymentRepository(): PaymentRepository {
    const repo = {
      insert: async (dados: Partial<Payment>) => {
        await proximoTique();
        if (
          dados.idempotencyKey &&
          this.pagamentos.some(
            (p) =>
              p.ownerId === dados.ownerId &&
              p.idempotencyKey === dados.idempotencyKey,
          )
        ) {
          throw violacao(PAYMENT_IDEMPOTENCY_KEY_UNICA);
        }
        const pagamento = {
          id: randomUUID(),
          createdAt: new Date(),
          ...dados,
        } as Payment;
        this.pagamentos.push(pagamento);
        return { ...pagamento };
      },
      findByIdempotencyKey: async (ownerId: string, chave: string) =>
        this.pagamentos.find(
          (p) => p.ownerId === ownerId && p.idempotencyKey === chave,
        ) ?? null,
      lockOwned: async (id: string, ownerId: string, manager: Manager) => {
        await this.travar(`payment:${id}`, manager);
        const p = this.pagamentos.find(
          (x) => x.id === id && x.ownerId === ownerId,
        );
        return p ? { ...p } : null;
      },
      addRefunded: async (id: string, valor: string) => {
        const p = this.pagamentos.find((x) => x.id === id) as Payment;
        p.refundedAmount = somar(p.refundedAmount, valor);
      },
      sumNetPaid: async (receivableId: string) => {
        await proximoTique();
        return somar(
          ...this.pagamentos
            .filter((p) => p.receivableId === receivableId)
            .map((p) => subtrair(p.amount, p.refundedAmount)),
        );
      },
      findPaged: async (
        ownerId: string,
        filtros: { method?: PaymentMethod },
      ) => {
        const lista = this.pagamentos.filter(
          (p) =>
            p.ownerId === ownerId &&
            (!filtros.method || p.method === filtros.method),
        );
        return [
          lista.map((p) => ({
            ...p,
            receivable: this.comPaciente(
              this.cobrancas.find((c) => c.id === p.receivableId) as Receivable,
            ),
            account: this.contas.find((c) => c.id === p.accountId) ?? null,
            receivedBy: this.nomeDe(p.receivedById),
          })),
          lista.length,
        ];
      },
      sumFiltered: async (
        ownerId: string,
        filtros: { method?: PaymentMethod },
      ) => {
        const lista = this.pagamentos.filter(
          (p) =>
            p.ownerId === ownerId &&
            (!filtros.method || p.method === filtros.method),
        );
        return {
          totalAmount: somar(...lista.map((p) => p.amount)),
          totalRefunded: somar(...lista.map((p) => p.refundedAmount)),
        };
      },
      receivedByMethodForSession: async (cashSessionId: string) => {
        const porForma = new Map<PaymentMethod, string>();
        this.pagamentos
          .filter((p) => p.cashSessionId === cashSessionId)
          .forEach((p) =>
            porForma.set(p.method, somar(porForma.get(p.method), p.amount)),
          );
        return [...porForma].map(([method, received]) => ({
          method,
          received,
        }));
      },
      findOwnedWithDetails: async (id: string, ownerId: string) =>
        this.pagamentos.find((p) => p.id === id && p.ownerId === ownerId) ??
        null,
    };
    return repo as unknown as PaymentRepository;
  }

  refundRepository(): RefundRepository {
    const repo = {
      insert: async (dados: Partial<Refund>) => {
        await proximoTique();
        const estorno = {
          id: randomUUID(),
          createdAt: new Date(),
          ...dados,
        } as Refund;
        this.estornos.push(estorno);
        return { ...estorno };
      },
      refundedByMethodForSession: async (cashSessionId: string) => {
        const porForma = new Map<PaymentMethod, string>();
        this.estornos
          .filter((e) => e.cashSessionId === cashSessionId)
          .forEach((e) => {
            const p = this.pagamentos.find(
              (x) => x.id === e.paymentId,
            ) as Payment;
            porForma.set(p.method, somar(porForma.get(p.method), e.amount));
          });
        return [...porForma].map(([method, refunded]) => ({
          method,
          refunded,
        }));
      },
    };
    return repo as unknown as RefundRepository;
  }

  saldoDoCaixa(cashSessionId: string): string {
    return somar(
      ...this.lancamentos
        .filter((l) => l.cashSessionId === cashSessionId)
        .map((l) =>
          l.direction === FinancialEntryDirection.IN
            ? l.amount
            : `-${l.amount}`,
        ),
    );
  }

  entryRepository(): FinancialEntryRepository {
    const repo = {
      insert: async (dados: Partial<FinancialEntry>) => {
        await proximoTique();
        if (!dados.accountId === !dados.cashSessionId) {
          throw new Error('CHK_financial_entries_account_xor_cash_session');
        }
        if (compararValores(dados.amount, '0') <= 0) {
          throw new Error('CHK_financial_entries_amount_positive');
        }
        const lancamento = {
          id: randomUUID(),
          counterpartEntryId: null,
          paymentId: null,
          refundId: null,
          createdAt: new Date(),
          ...dados,
        } as FinancialEntry;
        this.lancamentos.push(lancamento);
        return { ...lancamento };
      },
      linkCounterpart: async (id: string, counterpartEntryId: string) => {
        (
          this.lancamentos.find((l) => l.id === id) as FinancialEntry
        ).counterpartEntryId = counterpartEntryId;
      },
      cashSessionBalance: async (cashSessionId: string) => {
        await proximoTique();
        return this.saldoDoCaixa(cashSessionId);
      },
      findByCashSession: async (cashSessionId: string) =>
        this.lancamentos.filter((l) => l.cashSessionId === cashSessionId),
    };
    return repo as unknown as FinancialEntryRepository;
  }

  cashSessionRepository(): CashSessionRepository {
    const aberto = (userId: string, ownerId: string) =>
      this.caixas.find(
        (c) => c.userId === userId && c.ownerId === ownerId && !c.closedAt,
      );
    const repo = {
      insert: async (dados: Partial<CashSession>) => {
        await proximoTique();
        if (this.caixas.some((c) => c.userId === dados.userId && !c.closedAt)) {
          throw violacao(CASH_SESSION_ABERTA_UNICA);
        }
        const sessao = {
          id: randomUUID(),
          closedAt: null,
          countedAmount: null,
          expectedAmount: null,
          difference: null,
          notes: null,
          closedById: null,
          ...dados,
        } as CashSession;
        this.caixas.push(sessao);
        return { ...sessao };
      },
      save: async (sessao: CashSession) => {
        Object.assign(
          this.caixas.find((c) => c.id === sessao.id) as CashSession,
          sessao,
        );
        return sessao;
      },
      findOpenByUser: async (userId: string, ownerId: string) => {
        const c = aberto(userId, ownerId);
        return c ? { ...c } : null;
      },
      lockOpenByUser: async (
        userId: string,
        ownerId: string,
        manager: Manager,
      ) => {
        const c = aberto(userId, ownerId);
        if (!c) return null;
        await this.travar(`cash:${c.id}`, manager);
        const atual = this.caixas.find((x) => x.id === c.id) as CashSession;
        return atual.closedAt ? null : { ...atual };
      },
      lockOwned: async (id: string, ownerId: string, manager: Manager) => {
        await this.travar(`cash:${id}`, manager);
        const c = this.caixas.find((x) => x.id === id && x.ownerId === ownerId);
        return c ? { ...c } : null;
      },
      findOwnedWithPeople: async (id: string, ownerId: string) => {
        const c = this.caixas.find((x) => x.id === id && x.ownerId === ownerId);
        return c
          ? {
              ...c,
              user: this.nomeDe(c.userId),
              account: this.contas.find((conta) => conta.id === c.accountId),
              closedBy: this.nomeDe(c.closedById),
            }
          : null;
      },
      findPaged: async (ownerId: string, filtros: { userId?: string }) => {
        const lista = this.caixas.filter(
          (c) =>
            c.ownerId === ownerId &&
            (!filtros.userId || c.userId === filtros.userId),
        );
        return [
          lista.map((c) => ({
            ...c,
            user: this.nomeDe(c.userId),
            account: this.contas.find((conta) => conta.id === c.accountId),
          })),
          lista.length,
        ];
      },
    };
    return repo as unknown as CashSessionRepository;
  }

  accountsService(): FinancialAccountsService {
    const repo = {
      findOwned: async (id: string, ownerId: string) =>
        this.contas.find((c) => c.id === id && c.ownerId === ownerId) ?? null,
    };
    return new FinancialAccountsService(
      repo as unknown as FinancialAccountRepository,
      {
        hasOpenForAccount: async (accountId: string, ownerId: string) =>
          this.caixas.some(
            (c) =>
              c.accountId === accountId && c.ownerId === ownerId && !c.closedAt,
          ),
      } as unknown as CashSessionRepository,
    );
  }

  methodConfigsService(): PaymentMethodConfigsService {
    return {
      list: async () => this.configuracoes.map((c) => ({ ...c })),
    } as unknown as PaymentMethodConfigsService;
  }

  patientRepository(): PatientRepository {
    return {
      findOne: async (where: { id: string; ownerId: string }) =>
        this.pacientes.find(
          (p) => p.id === where.id && p.ownerId === where.ownerId,
        ) ?? null,
    } as unknown as PatientRepository;
  }

  appointmentRepository(): AppointmentRepository {
    return {
      findOne: async (where: { id: string; ownerId: string }) =>
        this.consultas.find(
          (c) => c.id === where.id && c.ownerId === where.ownerId,
        ) ?? null,
    } as unknown as AppointmentRepository;
  }

  userRepository(): UserRepository {
    return {
      findOneWithProfile: async (where: { id: string; ownerId?: string }) =>
        this.usuarios.find(
          (u) =>
            u.id === where.id &&
            (where.ownerId === undefined || u.ownerId === where.ownerId),
        ) ?? null,
      findDoctorsByOwnerId: async (ownerId: string) =>
        this.usuarios
          .filter((u) => u.ownerId === ownerId && u.doctorProfile)
          .sort((a, b) => a.name.localeCompare(b.name)),
    } as unknown as UserRepository;
  }
}

export interface ServicosFinanceiros {
  banco: BancoFalso;
  receivables: ReceivablesService;
  payments: PaymentsService;
  refunds: RefundsService;
  cashSessions: CashSessionsService;
  transfers: TransfersService;
}

export function montarServicos(): ServicosFinanceiros {
  const banco = new BancoFalso();
  const dataSource = banco.dataSource();
  const receivableRepository = banco.receivableRepository();
  const itemRepository = banco.itemRepository();
  const paymentRepository = banco.paymentRepository();
  const refundRepository = banco.refundRepository();
  const entryRepository = banco.entryRepository();
  const cashSessionRepository = banco.cashSessionRepository();
  const accountsService = banco.accountsService();

  const receivables = new ReceivablesService(
    dataSource,
    receivableRepository,
    itemRepository,
    paymentRepository,
    banco.patientRepository(),
    banco.appointmentRepository(),
    banco.userRepository(),
  );
  const payments = new PaymentsService(
    dataSource,
    receivables,
    paymentRepository,
    entryRepository,
    cashSessionRepository,
    banco.methodConfigsService(),
    accountsService,
  );
  const refunds = new RefundsService(
    dataSource,
    receivables,
    paymentRepository,
    refundRepository,
    entryRepository,
    cashSessionRepository,
  );
  const cashSessions = new CashSessionsService(
    dataSource,
    cashSessionRepository,
    entryRepository,
    paymentRepository,
    refundRepository,
    accountsService,
  );
  const transfers = new TransfersService(
    dataSource,
    entryRepository,
    accountsService,
  );
  return { banco, receivables, payments, refunds, cashSessions, transfers };
}
