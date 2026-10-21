import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Payment } from '../entities/payment.entity';
import { ReceivableStatus } from '../entities/receivable.entity';
import { BaseRepository } from './base.repository';

export const FUSO_DOS_RELATORIOS = 'America/Sao_Paulo';

export type AgrupamentoDeRecebimentos =
  | 'day'
  | 'month'
  | 'method'
  | 'account'
  | 'user';

export interface LinhaDeRecebimentos {
  chave: string | null;
  nome: string | null;
  recebido: string;
  estornado: string;
  quantidade: number;
}

export interface LinhaDeProducao {
  executedById: string | null;
  nome: string | null;
  itens: number;
  faturado: string;
  recebido: string;
}

export interface LinhaEmAberto {
  receivableId: string;
  patientId: string;
  patientName: string;
  referenceDate: string;
  dueDate: string | null;
  totalAmount: string;
  paidAmount: string;
  balance: string;
  ageDays: number;
}

export interface SaldosDoExtrato {
  saldoInicial: string;
  saldoFinal: string;
}

export interface LinhaDoExtrato {
  id: string;
  occurredAt: Date;
  direction: string;
  kind: string;
  amount: string;
  description: string | null;
  balance: string;
}

export interface PeriodoDeDatas {
  from: string;
  to: string;
}

const INICIO_DO_DIA = (parametro: string) =>
  `((${parametro})::date::timestamp AT TIME ZONE '${FUSO_DOS_RELATORIOS}')`;

const FIM_EXCLUSIVO = (parametro: string) =>
  `(((${parametro})::date + 1)::timestamp AT TIME ZONE '${FUSO_DOS_RELATORIOS}')`;

export function expressaoDeDataLocal(
  coluna: string,
  formato: 'YYYY-MM-DD' | 'YYYY-MM',
): string {
  return `to_char(${coluna} AT TIME ZONE '${FUSO_DOS_RELATORIOS}', '${formato}')`;
}

interface DimensaoDoAgrupamento {
  chave: (dataDoMovimento: string) => string;
  nome: string;
  joins: string;
}

const CONTA_DO_PAGAMENTO = 'COALESCE(p.account_id, cs.account_id)';

const DIMENSOES: Record<AgrupamentoDeRecebimentos, DimensaoDoAgrupamento> = {
  day: {
    chave: (data) => expressaoDeDataLocal(data, 'YYYY-MM-DD'),
    nome: 'NULL::text',
    joins: '',
  },
  month: {
    chave: (data) => expressaoDeDataLocal(data, 'YYYY-MM'),
    nome: 'NULL::text',
    joins: '',
  },
  method: {
    chave: () => 'p.method::text',
    nome: 'NULL::text',
    joins: '',
  },
  account: {
    chave: () => `${CONTA_DO_PAGAMENTO}::text`,
    nome: 'fa.name::text',
    joins: `LEFT JOIN cash_sessions cs ON cs.id = p.cash_session_id
      LEFT JOIN financial_accounts fa ON fa.id = ${CONTA_DO_PAGAMENTO}`,
  },
  user: {
    chave: () => 'p.received_by_id::text',
    nome: 'u.name::text',
    joins: 'LEFT JOIN users u ON u.id = p.received_by_id',
  },
};

export function sqlDosRecebimentos(
  agrupamento: AgrupamentoDeRecebimentos,
): string {
  const dimensao = DIMENSOES[agrupamento];
  if (!dimensao) throw new Error(`Agrupamento inválido: ${agrupamento}`);

  return `
    WITH movimentos AS (
      SELECT ${dimensao.chave('p.paid_at')} AS chave,
             ${dimensao.nome} AS nome,
             p.amount AS recebido,
             0::numeric AS estornado,
             1 AS quantidade
        FROM payments p
        ${dimensao.joins}
       WHERE p.owner_id = $1
         AND p.paid_at >= ${INICIO_DO_DIA('$2')}
         AND p.paid_at < ${FIM_EXCLUSIVO('$3')}
      UNION ALL
      SELECT ${dimensao.chave('r.created_at')} AS chave,
             ${dimensao.nome} AS nome,
             0::numeric AS recebido,
             r.amount AS estornado,
             0 AS quantidade
        FROM refunds r
        JOIN payments p ON p.id = r.payment_id AND p.owner_id = r.owner_id
        ${dimensao.joins}
       WHERE r.owner_id = $1
         AND r.created_at >= ${INICIO_DO_DIA('$2')}
         AND r.created_at < ${FIM_EXCLUSIVO('$3')}
    )
    SELECT chave,
           MAX(nome) AS nome,
           COALESCE(SUM(recebido), 0)::numeric(14,2)::text AS recebido,
           COALESCE(SUM(estornado), 0)::numeric(14,2)::text AS estornado,
           COALESCE(SUM(quantidade), 0)::int AS quantidade
      FROM movimentos
     GROUP BY chave
     ORDER BY MAX(nome) NULLS LAST, chave NULLS LAST
  `;
}

export const SQL_DA_PRODUCAO = `
  SELECT i.executed_by_id AS "executedById",
         MAX(u.name) AS nome,
         COUNT(*)::int AS itens,
         COALESCE(SUM(i.total), 0)::numeric(14,2)::text AS faturado,
         COALESCE(SUM(
           CASE WHEN r.total_amount > 0
                THEN ROUND(i.total / r.total_amount * r.paid_amount, 2)
                ELSE 0
           END
         ), 0)::numeric(14,2)::text AS recebido
    FROM receivable_items i
    JOIN receivables r ON r.id = i.receivable_id AND r.owner_id = i.owner_id
    LEFT JOIN users u ON u.id = i.executed_by_id
   WHERE i.owner_id = $1
     AND i.cancelled_at IS NULL
     AND r.cancelled_at IS NULL
     AND r.status <> '${ReceivableStatus.CANCELLED}'
     AND COALESCE(i.executed_at, r.reference_date) >= $2::date
     AND COALESCE(i.executed_at, r.reference_date) <= $3::date
   GROUP BY i.executed_by_id
   ORDER BY MAX(u.name) NULLS LAST
`;

export const SQL_EM_ABERTO = `
  SELECT r.id AS "receivableId",
         r.patient_id AS "patientId",
         pa.name AS "patientName",
         r.reference_date::text AS "referenceDate",
         r.due_date::text AS "dueDate",
         r.total_amount::text AS "totalAmount",
         r.paid_amount::text AS "paidAmount",
         (r.total_amount - r.paid_amount)::numeric(14,2)::text AS balance,
         GREATEST(
           0,
           (now() AT TIME ZONE '${FUSO_DOS_RELATORIOS}')::date
             - COALESCE(r.due_date, r.reference_date)
         )::int AS "ageDays"
    FROM receivables r
    JOIN patients pa ON pa.id = r.patient_id
   WHERE r.owner_id = $1
     AND r.status IN ('${ReceivableStatus.OPEN}', '${ReceivableStatus.PARTIAL}')
     AND COALESCE(r.due_date, r.reference_date) <= $2::date
   ORDER BY COALESCE(r.due_date, r.reference_date), pa.name, r.id
`;

const VALOR_COM_SINAL = `CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END`;

export const SQL_SALDOS_DO_EXTRATO = `
  SELECT COALESCE(SUM(${VALOR_COM_SINAL})
           FILTER (WHERE e.occurred_at < ${INICIO_DO_DIA('$3')}), 0)::numeric(14,2)::text AS "saldoInicial",
         COALESCE(SUM(${VALOR_COM_SINAL})
           FILTER (WHERE e.occurred_at < ${FIM_EXCLUSIVO('$4')}), 0)::numeric(14,2)::text AS "saldoFinal"
    FROM financial_entries e
   WHERE e.owner_id = $1
     AND e.account_id = $2
`;

export const SQL_MOVIMENTOS_DO_EXTRATO = `
  WITH anterior AS (
    SELECT COALESCE(SUM(${VALOR_COM_SINAL}), 0) AS saldo
      FROM financial_entries e
     WHERE e.owner_id = $1
       AND e.account_id = $2
       AND e.occurred_at < ${INICIO_DO_DIA('$3')}
  )
  SELECT e.id,
         e.occurred_at AS "occurredAt",
         e.direction,
         e.kind,
         e.amount::text AS amount,
         e.description,
         (anterior.saldo + SUM(${VALOR_COM_SINAL}) OVER (
           ORDER BY e.occurred_at, e.created_at, e.id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ))::numeric(14,2)::text AS balance
    FROM financial_entries e
   CROSS JOIN anterior
   WHERE e.owner_id = $1
     AND e.account_id = $2
     AND e.occurred_at >= ${INICIO_DO_DIA('$3')}
     AND e.occurred_at < ${FIM_EXCLUSIVO('$4')}
   ORDER BY e.occurred_at, e.created_at, e.id
`;

@Injectable()
export class FinanceReportsRepository extends BaseRepository<Payment> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Payment));
  }

  recebimentos(
    ownerId: string,
    periodo: PeriodoDeDatas,
    agrupamento: AgrupamentoDeRecebimentos,
  ): Promise<LinhaDeRecebimentos[]> {
    return this.repository.manager.query<LinhaDeRecebimentos[]>(
      sqlDosRecebimentos(agrupamento),
      [ownerId, periodo.from, periodo.to],
    );
  }

  producao(
    ownerId: string,
    periodo: PeriodoDeDatas,
  ): Promise<LinhaDeProducao[]> {
    return this.repository.manager.query<LinhaDeProducao[]>(SQL_DA_PRODUCAO, [
      ownerId,
      periodo.from,
      periodo.to,
    ]);
  }

  emAberto(ownerId: string, ate: string): Promise<LinhaEmAberto[]> {
    return this.repository.manager.query<LinhaEmAberto[]>(SQL_EM_ABERTO, [
      ownerId,
      ate,
    ]);
  }

  async saldosDoExtrato(
    ownerId: string,
    accountId: string,
    periodo: PeriodoDeDatas,
  ): Promise<SaldosDoExtrato> {
    const [linha] = await this.repository.manager.query<SaldosDoExtrato[]>(
      SQL_SALDOS_DO_EXTRATO,
      [ownerId, accountId, periodo.from, periodo.to],
    );
    return linha ?? { saldoInicial: '0.00', saldoFinal: '0.00' };
  }

  movimentosDoExtrato(
    ownerId: string,
    accountId: string,
    periodo: PeriodoDeDatas,
  ): Promise<LinhaDoExtrato[]> {
    return this.repository.manager.query<LinhaDoExtrato[]>(
      SQL_MOVIMENTOS_DO_EXTRATO,
      [ownerId, accountId, periodo.from, periodo.to],
    );
  }

  dadosDoRecibo(ownerId: string, paymentId: string): Promise<Payment | null> {
    return this.repository
      .createQueryBuilder('payment')
      .withDeleted()
      .innerJoin('payment.receivable', 'receivable')
      .innerJoin('receivable.patient', 'patient')
      .leftJoin('receivable.items', 'item')
      .select([
        'payment.id',
        'payment.ownerId',
        'payment.receivableId',
        'payment.method',
        'payment.amount',
        'payment.refundedAmount',
        'payment.paidAt',
        'payment.installments',
        'payment.cardBrand',
        'receivable.id',
        'receivable.ownerId',
        'patient.id',
        'patient.name',
        'patient.cpf',
        'item.id',
        'item.description',
        'item.executedById',
        'item.cancelledAt',
        'item.createdAt',
      ])
      .where('payment.id = :paymentId', { paymentId })
      .andWhere('payment.ownerId = :ownerId', { ownerId })
      .andWhere('receivable.ownerId = :ownerId', { ownerId })
      .orderBy('item.createdAt', 'ASC')
      .addOrderBy('item.id', 'ASC')
      .getOne();
  }
}
