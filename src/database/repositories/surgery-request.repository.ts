import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  FindOptionsWhere,
  DataSource,
  EntityManager,
  QueryDeepPartialEntity,
} from 'typeorm';
import { DOCUMENT_KEYS } from 'src/shared/constants/document-keys';

export interface SumInvoicedFilter {
  doctorIds?: string[];
}

import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from '../entities/surgery-request.entity';
import {
  SurgeryRequestActivity,
  ActivityType,
} from '../entities/surgery-request-activity.entity';
import { BaseRepository } from './base.repository';
import { getStatusLabel } from 'src/shared/utils';

@Global()
@Injectable()
export class SurgeryRequestRepository extends BaseRepository<SurgeryRequest> {
  constructor(
    @InjectRepository(SurgeryRequest)
    repository: Repository<SurgeryRequest>,
    private readonly dataSource: DataSource,
  ) {
    super(repository);
  }

  totalByHospital(
    doctorIds: string[],
    filters?: {
      hospitalId?: string;
      healthPlanId?: string;
      startDate?: Date;
      endDate?: Date;
    },
  ) {
    const qb = this.repository
      .createQueryBuilder('sr')
      .leftJoin('sr.hospital', 'h')
      .select('sr.hospitalId', 'hospitalId')
      .addSelect("COALESCE(h.name, 'Sem Hospital')", 'hospitalName')
      .addSelect('CAST(COUNT(*) AS INTEGER)', 'total')
      .where('sr.doctorId IN (:...doctorIds)', { doctorIds });
    if (filters?.hospitalId)
      qb.andWhere('sr.hospitalId = :hospitalId', {
        hospitalId: filters.hospitalId,
      });
    if (filters?.healthPlanId)
      qb.andWhere('sr.healthPlanId = :healthPlanId', {
        healthPlanId: filters.healthPlanId,
      });
    if (filters?.startDate)
      qb.andWhere('sr.createdAt >= :startDate', {
        startDate: filters.startDate,
      });
    if (filters?.endDate)
      qb.andWhere('sr.createdAt <= :endDate', { endDate: filters.endDate });
    return qb
      .groupBy('sr.hospitalId')
      .addGroupBy('h.name')
      .orderBy('COUNT(*)', 'DESC')
      .getRawMany();
  }

  totalByStatus(
    doctorIds: string[],
    filters?: {
      hospitalId?: string;
      healthPlanId?: string;
      startDate?: Date;
      endDate?: Date;
    },
  ) {
    const qb = this.repository
      .createQueryBuilder('sr')
      .select('sr.status', 'status')
      .addSelect('CAST(COUNT(*) AS INTEGER)', 'total')
      .where('sr.doctorId IN (:...doctorIds)', { doctorIds });
    if (filters?.hospitalId)
      qb.andWhere('sr.hospitalId = :hospitalId', {
        hospitalId: filters.hospitalId,
      });
    if (filters?.healthPlanId)
      qb.andWhere('sr.healthPlanId = :healthPlanId', {
        healthPlanId: filters.healthPlanId,
      });
    if (filters?.startDate)
      qb.andWhere('sr.createdAt >= :startDate', {
        startDate: filters.startDate,
      });
    if (filters?.endDate)
      qb.andWhere('sr.createdAt <= :endDate', { endDate: filters.endDate });
    return qb.groupBy('sr.status').orderBy('COUNT(*)', 'DESC').getRawMany();
  }

  totalByHealthPlan(
    doctorIds: string[],
    filters?: {
      hospitalId?: string;
      healthPlanId?: string;
      startDate?: Date;
      endDate?: Date;
    },
  ) {
    const qb = this.repository
      .createQueryBuilder('sr')
      .leftJoin('sr.healthPlan', 'hp')
      .select('sr.healthPlanId', 'healthPlanId')
      .addSelect("COALESCE(hp.name, 'Sem Convênio')", 'healthPlanName')
      .addSelect('CAST(COUNT(*) AS INTEGER)', 'total')
      .where('sr.doctorId IN (:...doctorIds)', { doctorIds });
    if (filters?.hospitalId)
      qb.andWhere('sr.hospitalId = :hospitalId', {
        hospitalId: filters.hospitalId,
      });
    if (filters?.healthPlanId)
      qb.andWhere('sr.healthPlanId = :healthPlanId', {
        healthPlanId: filters.healthPlanId,
      });
    if (filters?.startDate)
      qb.andWhere('sr.createdAt >= :startDate', {
        startDate: filters.startDate,
      });
    if (filters?.endDate)
      qb.andWhere('sr.createdAt <= :endDate', { endDate: filters.endDate });
    return qb
      .groupBy('sr.healthPlanId')
      .addGroupBy('hp.name')
      .orderBy('COUNT(*)', 'DESC')
      .getRawMany();
  }

  async sumInvoiced(
    filter: SumInvoicedFilter,
  ): Promise<{ invoicedValue: number; receivedValue: number }> {
    const qb = this.repository
      .createQueryBuilder('sr')
      .leftJoin('sr.billing', 'srb')
      .select('COALESCE(SUM(srb.invoiceValue), 0)', 'invoicedValue')
      .addSelect('COALESCE(SUM(srb.receivedValue), 0)', 'receivedValue');

    if (filter.doctorIds?.length) {
      qb.andWhere('sr.doctorId IN (:...doctorIds)', {
        doctorIds: filter.doctorIds,
      });
    }

    const result = await qb.getRawOne();

    return {
      invoicedValue: Number(result?.invoicedValue) || 0,
      receivedValue: Number(result?.receivedValue) || 0,
    };
  }

  async total(where: FindOptionsWhere<SurgeryRequest>): Promise<number> {
    return await this.repository.count({ where });
  }

  async findOne(
    where: FindOptionsWhere<SurgeryRequest>,
  ): Promise<SurgeryRequest | null> {
    const queryBuilder = this.repository
      .createQueryBuilder('surgeryRequest')
      .leftJoin('surgeryRequest.createdBy', 'createdBy')
      .addSelect(['createdBy.id', 'createdBy.name', 'createdBy.avatarUrl'])
      .leftJoin('surgeryRequest.doctor', 'doctor')
      .addSelect(['doctor.id', 'doctor.name', 'doctor.avatarUrl'])
      .leftJoinAndSelect('doctor.doctorProfile', 'doctorProfile')
      .leftJoinAndSelect('doctorProfile.header', 'doctor_profile_header')
      .leftJoinAndSelect('surgeryRequest.patient', 'patient')
      .leftJoinAndSelect('surgeryRequest.hospital', 'hospital')
      .leftJoinAndSelect('surgeryRequest.healthPlan', 'healthPlan')
      .leftJoinAndSelect('surgeryRequest.opmeItems', 'opmeItems')
      .leftJoinAndSelect('opmeItems.suppliers', 'opme_item_suppliers')
      .leftJoinAndSelect('opmeItems.manufacturers', 'opme_item_manufacturers')
      .leftJoinAndSelect(
        'opmeItems.selectedSupplier',
        'opme_item_selected_supplier',
      )
      .leftJoinAndSelect('surgeryRequest.procedure', 'procedure')
      .leftJoinAndSelect('surgeryRequest.tussItems', 'tussItems')
      .leftJoinAndSelect('surgeryRequest.documents', 'documents')
      .leftJoin('documents.creator', 'documents_creator')
      .addSelect(['documents_creator.id', 'documents_creator.name'])
      .leftJoinAndSelect('surgeryRequest.quotations', 'quotations')
      .leftJoinAndSelect('quotations.supplier', 'quotations_supplier')
      .leftJoinAndSelect('surgeryRequest.activities', 'activities')
      .leftJoinAndSelect('surgeryRequest.analysis', 'analysis')
      .leftJoinAndSelect('surgeryRequest.billing', 'billing')
      .leftJoinAndSelect('surgeryRequest.contestations', 'contestations')
      .where(where)
      .orderBy('activities.createdAt', 'DESC');

    const entity = await queryBuilder.getOne();

    if (entity) {
      const pendencies = this.calculatePendencies(entity);
      return {
        ...entity,
        pendenciesCount: pendencies.pendingCount,
        completedCount: pendencies.completedCount,
        totalPendencies: pendencies.totalCount,
      } as SurgeryRequest & {
        pendenciesCount: number;
        completedCount: number;
        totalPendencies: number;
      };
    }

    return entity;
  }

  async findOneSimple(
    where: FindOptionsWhere<SurgeryRequest>,
  ): Promise<SurgeryRequest | null> {
    return await this.repository.findOne({ where });
  }

  /** Carrega campos base + paciente, médico e plano. Sem documents/chats/quotations. */
  async findOneMinimal(
    where: FindOptionsWhere<SurgeryRequest>,
  ): Promise<SurgeryRequest | null> {
    return await this.repository
      .createQueryBuilder('sr')
      .leftJoinAndSelect('sr.patient', 'patient')
      .leftJoinAndSelect('sr.doctor', 'doctor')
      .leftJoinAndSelect('doctor.doctorProfile', 'doctorProfile')
      .leftJoinAndSelect('sr.healthPlan', 'healthPlan')
      .leftJoinAndSelect('sr.hospital', 'hospital')
      .leftJoinAndSelect('sr.procedure', 'procedure')
      .where(where)
      .getOne();
  }

  /** Carrega dados de workflow: campos base + activities + análise + contestações. */
  async findOneForWorkflow(
    where: FindOptionsWhere<SurgeryRequest>,
  ): Promise<SurgeryRequest | null> {
    return await this.repository
      .createQueryBuilder('sr')
      .leftJoinAndSelect('sr.patient', 'patient')
      .leftJoinAndSelect('sr.doctor', 'doctor')
      .leftJoinAndSelect('doctor.doctorProfile', 'doctorProfile')
      .leftJoinAndSelect('sr.healthPlan', 'healthPlan')
      .leftJoinAndSelect('sr.hospital', 'hospital')
      .leftJoinAndSelect('sr.procedure', 'procedure')
      .leftJoinAndSelect('sr.analysis', 'analysis')
      .leftJoinAndSelect('sr.contestations', 'contestations')
      .leftJoinAndSelect('sr.tussItems', 'tussItems')
      .leftJoinAndSelect('sr.opmeItems', 'opmeItems')
      .leftJoinAndSelect('opmeItems.suppliers', 'opme_items_suppliers')
      .leftJoinAndSelect('opmeItems.manufacturers', 'opme_items_manufacturers')
      .leftJoinAndSelect(
        'opmeItems.selectedSupplier',
        'opme_items_selected_supplier',
      )
      .leftJoinAndSelect('sr.documents', 'documents')
      .where(where)
      .getOne();
  }

  /** Carrega dados de faturamento: campos base + billing + procedures + tuss. */
  async findOneForBilling(
    where: FindOptionsWhere<SurgeryRequest>,
  ): Promise<SurgeryRequest | null> {
    return await this.repository
      .createQueryBuilder('sr')
      .leftJoinAndSelect('sr.patient', 'patient')
      .leftJoinAndSelect('sr.doctor', 'doctor')
      .leftJoinAndSelect('sr.healthPlan', 'healthPlan')
      .leftJoinAndSelect('sr.hospital', 'hospital')
      .leftJoinAndSelect('sr.procedure', 'procedure')
      .leftJoinAndSelect('sr.billing', 'billing')
      .leftJoinAndSelect('sr.tussItems', 'tussItems')
      .leftJoinAndSelect('sr.opmeItems', 'opmeItems')
      .leftJoinAndSelect('opmeItems.suppliers', 'opme_items_billing_suppliers')
      .leftJoinAndSelect(
        'opmeItems.manufacturers',
        'opme_items_billing_manufacturers',
      )
      .leftJoinAndSelect(
        'opmeItems.selectedSupplier',
        'opme_items_billing_selected_supplier',
      )
      .where(where)
      .getOne();
  }

  async findMany(
    where: FindOptionsWhere<SurgeryRequest>,
    skip: number,
    take: number,
  ): Promise<
    Array<
      SurgeryRequest & {
        pendenciesCount: number;
        completedCount: number;
        totalPendencies: number;
        hasIncompletePayment: boolean;
      }
    >
  > {
    const queryBuilder = this.repository
      .createQueryBuilder('surgeryRequest')
      .leftJoin('surgeryRequest.createdBy', 'createdBy')
      .leftJoin('surgeryRequest.doctor', 'doctor')
      .leftJoin('surgeryRequest.patient', 'patient')
      .leftJoin('surgeryRequest.healthPlan', 'healthPlan')
      .leftJoin('surgeryRequest.hospital', 'hospital')
      .leftJoin('surgeryRequest.procedure', 'procedure')
      .leftJoin('surgeryRequest.billing', 'billing')
      .leftJoin('surgeryRequest.documents', 'documents')
      .where(where)
      .orderBy('surgeryRequest.createdAt', 'DESC')
      .skip(skip)
      .take(take)
      .select([
        'surgeryRequest.id',
        'surgeryRequest.status',
        'surgeryRequest.doctorId',
        'surgeryRequest.ownerId',
        'surgeryRequest.healthPlanId',
        'surgeryRequest.hospitalId',
        'surgeryRequest.createdAt',
        'surgeryRequest.lastStatusChangedAt',
        'surgeryRequest.isIndication',
        'surgeryRequest.indicationName',
        'surgeryRequest.protocol',
        'surgeryRequest.priority',
        'surgeryRequest.surgeryDate',
        'createdBy.id',
        'createdBy.name',
        'doctor.id',
        'doctor.name',
        'patient.id',
        'patient.name',
        'healthPlan.id',
        'healthPlan.name',
        'hospital.id',
        'hospital.name',
        'procedure.id',
        'procedure.name',
        'billing.id',
        'billing.invoiceValue',
        'billing.receivedValue',
        'documents.id',
        'documents.type',
      ])
      .groupBy('surgeryRequest.id')
      .addGroupBy('createdBy.id')
      .addGroupBy('doctor.id')
      .addGroupBy('patient.id')
      .addGroupBy('healthPlan.id')
      .addGroupBy('hospital.id')
      .addGroupBy('procedure.id')
      .addGroupBy('billing.id')
      .addGroupBy('documents.id');

    const results = await queryBuilder.getRawAndEntities();

    const getRawNumber = (row: Record<string, unknown>, keys: string[]) => {
      for (const key of keys) {
        const value = row[key];
        if (value == null) continue;
        const n = Number(value);
        if (Number.isFinite(n)) return n;
      }
      return NaN;
    };

    const getRawId = (row: Record<string, unknown>) => {
      const value =
        row.surgeryRequest_id ??
        row.surgery_request_id ??
        row.surgeryrequest_id;
      return value != null ? String(value) : null;
    };

    const hasIncompletePaymentById = new Map<string, boolean>();

    for (const rawRow of results.raw as Record<string, unknown>[]) {
      const id = getRawId(rawRow);
      if (!id) continue;

      const invoiceValue = getRawNumber(rawRow, [
        'billing_invoice_value',
        'billing_invoiceValue',
      ]);
      const receivedValue = getRawNumber(rawRow, [
        'billing_received_value',
        'billing_receivedValue',
      ]);

      const hasIncompletePayment =
        Number.isFinite(invoiceValue) &&
        Number.isFinite(receivedValue) &&
        receivedValue < invoiceValue;

      if (hasIncompletePayment) {
        hasIncompletePaymentById.set(id, true);
      } else if (!hasIncompletePaymentById.has(id)) {
        hasIncompletePaymentById.set(id, false);
      }
    }

    return results.entities.map((entity) => {
      const pendencies = this.calculatePendencies(entity);
      const hasIncompletePayment =
        hasIncompletePaymentById.get(entity.id) ?? false;

      return {
        ...entity,
        pendenciesCount: pendencies.pendingCount,
        completedCount: pendencies.completedCount,
        totalPendencies: pendencies.totalCount,
        hasIncompletePayment,
      };
    });
  }

  async create(data: Partial<SurgeryRequest>): Promise<SurgeryRequest> {
    const surgeryRequest = this.repository.create(data);
    return await this.repository.save(surgeryRequest);
  }

  async update(
    id: string,
    data: Partial<SurgeryRequest>,
  ): Promise<SurgeryRequest | null> {
    await this.repository.update(
      id,
      data as QueryDeepPartialEntity<SurgeryRequest>,
    );
    return await this.repository.findOne({ where: { id } });
  }

  async findOneWithRelations(
    where: FindOptionsWhere<SurgeryRequest>,
    relations: string[],
  ): Promise<SurgeryRequest | null> {
    return await this.repository.findOne({
      where,
      relations,
    });
  }

  /** Carrega solicitação com todas as relações padrão necessárias para a state machine */
  findOneWithAllRelations(
    where: FindOptionsWhere<SurgeryRequest>,
  ): Promise<SurgeryRequest | null> {
    return this.findOneWithRelations(where, [
      'createdBy',
      'doctor',
      'doctor.doctorProfile',
      'patient',
      'hospital',
      'healthPlan',
      'tussItems',
      'opmeItems',
      'opmeItems.suppliers',
      'opmeItems.manufacturers',
      'opmeItems.selectedSupplier',
      'documents',
      'activities',
      'analysis',
      'billing',
      'contestations',
      'reportSections',
    ]);
  }

  async findDistinctActivityUserIds(
    surgeryRequestId: string,
  ): Promise<string[]> {
    const results = await this.dataSource
      .getRepository(SurgeryRequestActivity)
      .createQueryBuilder('a')
      .select('DISTINCT a.userId', 'userId')
      .where('a.surgeryRequestId = :surgeryRequestId', { surgeryRequestId })
      .andWhere('a.userId IS NOT NULL')
      .getRawMany();
    return results.map((r) => r.userId);
  }

  /**
   * Recupera o número do status anterior a partir do conteúdo da última activity
   * do tipo STATUS_CHANGE (formato: "Status alterado de \"X\" para \"Y\"").
   */
  async findPreviousStatus(
    surgeryRequestId: string,
  ): Promise<SurgeryRequestStatus | null> {
    const last = await this.dataSource
      .getRepository(SurgeryRequestActivity)
      .createQueryBuilder('a')
      .where('a.surgeryRequestId = :surgeryRequestId', { surgeryRequestId })
      .andWhere('a.type = :type', { type: ActivityType.STATUS_CHANGE })
      .orderBy('a.createdAt', 'DESC')
      .getOne();

    if (!last) return null;

    const match = last.content.match(/de\s+"([^"]+)"\s+para\s+"([^"]+)"/i);
    if (!match) return null;

    const prevLabel = match[1];
    const STATUSES: SurgeryRequestStatus[] = [
      SurgeryRequestStatus.PENDING,
      SurgeryRequestStatus.SENT,
      SurgeryRequestStatus.IN_ANALYSIS,
      SurgeryRequestStatus.IN_SCHEDULING,
      SurgeryRequestStatus.SCHEDULED,
      SurgeryRequestStatus.PERFORMED,
      SurgeryRequestStatus.INVOICED,
      SurgeryRequestStatus.FINALIZED,
      SurgeryRequestStatus.CLOSED,
    ];
    return STATUSES.find((s) => getStatusLabel(s) === prevLabel) ?? null;
  }

  /** Registra mudança de status em activities (deve ser chamado dentro de uma transação) */
  async recordStatusChange(
    manager: EntityManager,
    surgeryRequestId: string,
    prevStatus: SurgeryRequestStatus,
    newStatus: SurgeryRequestStatus,
    userId: string | null = null,
    statusChangedAt?: Date,
  ): Promise<void> {
    const surgeryRequestRepo = manager.getRepository(SurgeryRequest);
    await surgeryRequestRepo.update(surgeryRequestId, {
      lastStatusChangedAt: statusChangedAt ?? new Date(),
    });

    const activityRepo = manager.getRepository(SurgeryRequestActivity);
    const prevLabel = getStatusLabel(prevStatus);
    const newLabel = getStatusLabel(newStatus);
    await activityRepo.save({
      surgeryRequestId,
      userId,
      type: ActivityType.STATUS_CHANGE,
      content: `Status alterado de "${prevLabel}" para "${newLabel}"`,
    });
  }

  async getTemporalEvolution(
    where: FindOptionsWhere<SurgeryRequest>,
    startDate: Date,
    endDate: Date,
  ): Promise<Array<{ date: string; count: string; invoicedValue: string }>> {
    const queryBuilder = this.repository
      .createQueryBuilder('surgeryRequest')
      .leftJoin('surgeryRequest.billing', 'billing')
      .select('DATE(surgeryRequest.createdAt)', 'date')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(billing.invoiceValue)', 'invoicedValue')
      .where(where)
      .andWhere('surgeryRequest.createdAt BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .groupBy('DATE(surgeryRequest.createdAt)')
      .orderBy('DATE(surgeryRequest.createdAt)', 'ASC');

    return await queryBuilder.getRawMany();
  }

  async getMonthlyEvolution(
    where: FindOptionsWhere<SurgeryRequest>,
    months = 6,
  ): Promise<Array<{ monthKey: string; monthLabel: string; count: string }>> {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const queryBuilder = this.repository
      .createQueryBuilder('surgeryRequest')
      .select("TO_CHAR(surgeryRequest.createdAt, 'YYYY-MM')", 'monthKey')
      .addSelect("TO_CHAR(surgeryRequest.createdAt, 'Mon/YY')", 'monthLabel')
      .addSelect('COUNT(*)', 'count')
      .where(where)
      .andWhere('surgeryRequest.createdAt >= :startDate', { startDate })
      .groupBy("TO_CHAR(surgeryRequest.createdAt, 'YYYY-MM')")
      .addGroupBy("TO_CHAR(surgeryRequest.createdAt, 'Mon/YY')")
      .orderBy("TO_CHAR(surgeryRequest.createdAt, 'YYYY-MM')", 'ASC');

    return await queryBuilder.getRawMany();
  }

  async getAverageCompletionTime(
    where: FindOptionsWhere<SurgeryRequest>,
  ): Promise<{ averageDays: number }> {
    // Calcula a média de dias entre createdAt e updatedAt para solicitações finalizadas (status 9)
    const result = await this.repository
      .createQueryBuilder('surgeryRequest')
      .select(
        'AVG(EXTRACT(DAY FROM (surgeryRequest.updatedAt - surgeryRequest.createdAt)))',
        'averageDays',
      )
      .where({ ...where, status: SurgeryRequestStatus.CLOSED })
      .getRawOne();

    return {
      averageDays: result?.averageDays
        ? parseFloat(parseFloat(result.averageDays).toFixed(1))
        : 0,
    };
  }

  // ============================================================
  // Pendências — use PendencyValidatorService para validação completa
  // O método calculatePendencies abaixo é simplificado para uso em listagens
  // ============================================================

  calculatePendencies(surgeryRequest: SurgeryRequest): {
    pendingCount: number;
    completedCount: number;
    totalCount: number;
  } {
    // Lógica simplificada para kanban/listagens
    // A validação detalhada fica no PendencyValidatorService
    const documents = surgeryRequest.documents || [];
    const procedure = surgeryRequest.procedure;
    const patient = surgeryRequest.patient;

    const checks = [
      !!(patient?.name && patient?.email),
      !!surgeryRequest.healthPlanId,
      !!procedure,
      documents.some((d) => d.type === DOCUMENT_KEYS.DOCTOR_REQUEST),
    ];

    const completedCount = checks.filter(Boolean).length;
    const totalCount = checks.length;
    const pendingCount = totalCount - completedCount;

    return { pendingCount, completedCount, totalCount };
  }

  /**
   * Busca solicitações paradas (stale) — que não mudaram de status há mais de `minDays` dias.
   * Exclui status finais: PERFORMED, INVOICED, FINALIZED, CLOSED.
   */
  findStaleRequests(minDays: number): Promise<SurgeryRequest[]> {
    const terminalStatuses = [
      SurgeryRequestStatus.PERFORMED,
      SurgeryRequestStatus.INVOICED,
      SurgeryRequestStatus.FINALIZED,
      SurgeryRequestStatus.CLOSED,
    ];

    return this.repository
      .createQueryBuilder('sr')
      .leftJoinAndSelect('sr.patient', 'patient')
      .leftJoinAndSelect('sr.createdBy', 'createdBy')
      .where('sr.status NOT IN (:...terminalStatuses)', { terminalStatuses })
      .andWhere(
        `COALESCE(sr.lastStatusChangedAt, sr.createdAt) <= NOW() - INTERVAL '1 day' * :minDays`,
        { minDays },
      )
      .getMany();
  }
}
