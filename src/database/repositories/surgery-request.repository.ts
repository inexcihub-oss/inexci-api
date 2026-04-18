import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  FindOptionsWhere,
  DataSource,
  EntityManager,
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
import { StatusUpdate } from '../entities/status-update.entity';
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
      .select('sr.hospital_id', 'hospital_id')
      .addSelect("COALESCE(h.name, 'Sem Hospital')", 'hospital_name')
      .addSelect('CAST(COUNT(*) AS INTEGER)', 'total')
      .where('sr.doctor_id IN (:...doctorIds)', { doctorIds });
    if (filters?.hospitalId)
      qb.andWhere('sr.hospital_id = :hospitalId', {
        hospitalId: filters.hospitalId,
      });
    if (filters?.healthPlanId)
      qb.andWhere('sr.health_plan_id = :healthPlanId', {
        healthPlanId: filters.healthPlanId,
      });
    if (filters?.startDate)
      qb.andWhere('sr.created_at >= :startDate', {
        startDate: filters.startDate,
      });
    if (filters?.endDate)
      qb.andWhere('sr.created_at <= :endDate', { endDate: filters.endDate });
    return qb
      .groupBy('sr.hospital_id')
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
      .where('sr.doctor_id IN (:...doctorIds)', { doctorIds });
    if (filters?.hospitalId)
      qb.andWhere('sr.hospital_id = :hospitalId', {
        hospitalId: filters.hospitalId,
      });
    if (filters?.healthPlanId)
      qb.andWhere('sr.health_plan_id = :healthPlanId', {
        healthPlanId: filters.healthPlanId,
      });
    if (filters?.startDate)
      qb.andWhere('sr.created_at >= :startDate', {
        startDate: filters.startDate,
      });
    if (filters?.endDate)
      qb.andWhere('sr.created_at <= :endDate', { endDate: filters.endDate });
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
      .leftJoin('sr.health_plan', 'hp')
      .select('sr.health_plan_id', 'health_plan_id')
      .addSelect("COALESCE(hp.name, 'Sem Convênio')", 'health_plan_name')
      .addSelect('CAST(COUNT(*) AS INTEGER)', 'total')
      .where('sr.doctor_id IN (:...doctorIds)', { doctorIds });
    if (filters?.hospitalId)
      qb.andWhere('sr.hospital_id = :hospitalId', {
        hospitalId: filters.hospitalId,
      });
    if (filters?.healthPlanId)
      qb.andWhere('sr.health_plan_id = :healthPlanId', {
        healthPlanId: filters.healthPlanId,
      });
    if (filters?.startDate)
      qb.andWhere('sr.created_at >= :startDate', {
        startDate: filters.startDate,
      });
    if (filters?.endDate)
      qb.andWhere('sr.created_at <= :endDate', { endDate: filters.endDate });
    return qb
      .groupBy('sr.health_plan_id')
      .addGroupBy('hp.name')
      .orderBy('COUNT(*)', 'DESC')
      .getRawMany();
  }

  async sumInvoiced(filter: SumInvoicedFilter) {
    const qb = this.repository
      .createQueryBuilder('sr')
      .leftJoin('sr.billing', 'srb')
      .select('COALESCE(SUM(srb.invoice_value), 0)', 'invoiced_value')
      .addSelect('COALESCE(SUM(srb.received_value), 0)', 'received_value');

    if (filter.doctorIds?.length) {
      qb.andWhere('sr.doctor_id IN (:...doctorIds)', {
        doctorIds: filter.doctorIds,
      });
    }

    const result = await qb.getRawOne();

    return {
      _sum: {
        invoiced_value: result?.invoiced_value || null,
        received_value: result?.received_value || null,
      },
    };
  }

  async total(where: FindOptionsWhere<SurgeryRequest>): Promise<number> {
    return await this.repository.count({ where });
  }

  async findOne(
    where: FindOptionsWhere<SurgeryRequest>,
  ): Promise<SurgeryRequest | null> {
    const queryBuilder = this.repository
      .createQueryBuilder('surgery_request')
      .leftJoin('surgery_request.created_by', 'created_by')
      .addSelect(['created_by.id', 'created_by.name', 'created_by.avatar_url'])
      .leftJoin('surgery_request.manager', 'manager')
      .addSelect(['manager.id', 'manager.name', 'manager.avatar_url'])
      .leftJoin('surgery_request.doctor', 'doctor')
      .addSelect(['doctor.id', 'doctor.name', 'doctor.avatar_url'])
      .leftJoinAndSelect('doctor.doctor_profile', 'doctor_profile')
      .leftJoinAndSelect('surgery_request.patient', 'patient')
      .leftJoinAndSelect('surgery_request.hospital', 'hospital')
      .leftJoinAndSelect('surgery_request.health_plan', 'health_plan')
      .leftJoinAndSelect('surgery_request.opme_items', 'opme_items')
      .leftJoinAndSelect('surgery_request.procedure', 'procedure')
      .leftJoinAndSelect('surgery_request.tuss_items', 'tuss_items')
      .leftJoinAndSelect('surgery_request.cid', 'cid')
      .leftJoinAndSelect('surgery_request.documents', 'documents')
      .leftJoin('documents.creator', 'documents_creator')
      .addSelect(['documents_creator.id', 'documents_creator.name'])
      .leftJoinAndSelect('surgery_request.quotations', 'quotations')
      .leftJoinAndSelect('quotations.supplier', 'quotations_supplier')
      .leftJoinAndSelect('surgery_request.status_updates', 'status_updates')
      .leftJoinAndSelect('surgery_request.chats', 'chats')
      .leftJoin('chats.user', 'chats_user')
      .addSelect(['chats_user.id', 'chats_user.name', 'chats_user.avatar_url'])
      .leftJoinAndSelect('chats.messages', 'messages')
      .leftJoinAndSelect('surgery_request.analysis', 'analysis')
      .leftJoinAndSelect('surgery_request.billing', 'billing')
      .leftJoinAndSelect('surgery_request.contestations', 'contestations')
      .where(where)
      .orderBy('status_updates.created_at', 'DESC')
      .addOrderBy('messages.created_at', 'ASC');

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
      .leftJoinAndSelect('doctor.doctor_profile', 'doctor_profile')
      .leftJoinAndSelect('sr.health_plan', 'health_plan')
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
      .leftJoinAndSelect('doctor.doctor_profile', 'doctor_profile')
      .leftJoinAndSelect('sr.health_plan', 'health_plan')
      .leftJoinAndSelect('sr.hospital', 'hospital')
      .leftJoinAndSelect('sr.procedure', 'procedure')
      .leftJoinAndSelect('sr.analysis', 'analysis')
      .leftJoinAndSelect('sr.contestations', 'contestations')
      .leftJoinAndSelect('sr.tuss_items', 'tuss_items')
      .leftJoinAndSelect('sr.opme_items', 'opme_items')
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
      .leftJoinAndSelect('sr.health_plan', 'health_plan')
      .leftJoinAndSelect('sr.hospital', 'hospital')
      .leftJoinAndSelect('sr.procedure', 'procedure')
      .leftJoinAndSelect('sr.billing', 'billing')
      .leftJoinAndSelect('sr.tuss_items', 'tuss_items')
      .leftJoinAndSelect('sr.opme_items', 'opme_items')
      .where(where)
      .getOne();
  }

  async findMany(
    where: FindOptionsWhere<SurgeryRequest>,
    skip: number,
    take: number,
  ): Promise<any[]> {
    const queryBuilder = this.repository
      .createQueryBuilder('surgery_request')
      .leftJoin('surgery_request.created_by', 'created_by')
      .leftJoin('surgery_request.manager', 'manager')
      .leftJoin('surgery_request.patient', 'patient')
      .leftJoin('surgery_request.health_plan', 'health_plan')
      .leftJoin('surgery_request.hospital', 'hospital')
      .leftJoin('surgery_request.procedure', 'procedure')
      .leftJoin('surgery_request.documents', 'documents')
      .where(where)
      .orderBy('surgery_request.created_at', 'DESC')
      .skip(skip)
      .take(take)
      .select([
        'surgery_request.id',
        'surgery_request.status',
        'surgery_request.health_plan_id',
        'surgery_request.hospital_id',
        'surgery_request.created_at',
        'surgery_request.is_indication',
        'surgery_request.indication_name',
        'surgery_request.deadline',
        'surgery_request.protocol',
        'surgery_request.priority',
        'created_by.id',
        'created_by.name',
        'manager.id',
        'manager.name',
        'patient.id',
        'patient.name',
        'health_plan.id',
        'health_plan.name',
        'hospital.id',
        'hospital.name',
        'procedure.id',
        'procedure.name',
        'documents.id',
        'documents.type',
      ])
      .groupBy('surgery_request.id')
      .addGroupBy('created_by.id')
      .addGroupBy('manager.id')
      .addGroupBy('patient.id')
      .addGroupBy('health_plan.id')
      .addGroupBy('hospital.id')
      .addGroupBy('procedure.id')
      .addGroupBy('documents.id');

    const results = await queryBuilder.getRawAndEntities();

    return results.entities.map((entity: any) => {
      const pendencies = this.calculatePendencies(entity);

      return {
        ...entity,
        pendenciesCount: pendencies.pendingCount,
        completedCount: pendencies.completedCount,
        totalPendencies: pendencies.totalCount,
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
  ): Promise<SurgeryRequest> {
    await this.repository.update(id, data);
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
      'created_by',
      'patient',
      'hospital',
      'health_plan',
      'tuss_items',
      'opme_items',
      'documents',
      'analysis',
      'billing',
      'contestations',
    ]);
  }

  async findDistinctActivityUserIds(
    surgeryRequestId: string,
  ): Promise<string[]> {
    const results = await this.dataSource
      .getRepository(SurgeryRequestActivity)
      .createQueryBuilder('a')
      .select('DISTINCT a.user_id', 'user_id')
      .where('a.surgery_request_id = :surgeryRequestId', { surgeryRequestId })
      .andWhere('a.user_id IS NOT NULL')
      .getRawMany();
    return results.map((r) => r.user_id);
  }

  /** Registra mudança de status em status_updates e em activities (deve ser chamado dentro de uma transação) */
  async recordStatusChange(
    manager: EntityManager,
    surgeryRequestId: string,
    prevStatus: SurgeryRequestStatus,
    newStatus: SurgeryRequestStatus,
    userId: string | null = null,
  ): Promise<void> {
    const now = new Date();

    const surgeryRequestRepo = manager.getRepository(SurgeryRequest);
    await surgeryRequestRepo.update(surgeryRequestId, {
      last_status_changed_at: now,
    });

    const statusUpdateRepo = manager.getRepository(StatusUpdate);
    await statusUpdateRepo.save({
      surgery_request_id: surgeryRequestId,
      prev_status: prevStatus,
      new_status: newStatus,
    });

    const activityRepo = manager.getRepository(SurgeryRequestActivity);
    const prevLabel = getStatusLabel(prevStatus);
    const newLabel = getStatusLabel(newStatus);
    await activityRepo.save({
      surgery_request_id: surgeryRequestId,
      user_id: userId,
      type: ActivityType.STATUS_CHANGE,
      content: `Status alterado de "${prevLabel}" para "${newLabel}"`,
    });
  }

  async getTemporalEvolution(
    where: FindOptionsWhere<SurgeryRequest>,
    startDate: Date,
    endDate: Date,
  ): Promise<any[]> {
    const queryBuilder = this.repository
      .createQueryBuilder('surgery_request')
      .leftJoin('surgery_request.billing', 'billing')
      .select('DATE(surgery_request.created_at)', 'date')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(billing.invoice_value)', 'invoiced_value')
      .where(where)
      .andWhere('surgery_request.created_at BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .groupBy('DATE(surgery_request.created_at)')
      .orderBy('DATE(surgery_request.created_at)', 'ASC');

    return await queryBuilder.getRawMany();
  }

  async getMonthlyEvolution(
    where: FindOptionsWhere<SurgeryRequest>,
    months: number = 6,
  ): Promise<any[]> {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const queryBuilder = this.repository
      .createQueryBuilder('surgery_request')
      .select("TO_CHAR(surgery_request.created_at, 'YYYY-MM')", 'month_key')
      .addSelect("TO_CHAR(surgery_request.created_at, 'Mon/YY')", 'month_label')
      .addSelect('COUNT(*)', 'count')
      .where(where)
      .andWhere('surgery_request.created_at >= :startDate', { startDate })
      .groupBy("TO_CHAR(surgery_request.created_at, 'YYYY-MM')")
      .addGroupBy("TO_CHAR(surgery_request.created_at, 'Mon/YY')")
      .orderBy("TO_CHAR(surgery_request.created_at, 'YYYY-MM')", 'ASC');

    return await queryBuilder.getRawMany();
  }

  async getAverageCompletionTime(
    where: FindOptionsWhere<SurgeryRequest>,
  ): Promise<any> {
    // Calcula a média de dias entre created_at e updated_at para solicitações finalizadas (status 9)
    const result = await this.repository
      .createQueryBuilder('surgery_request')
      .select(
        'AVG(EXTRACT(DAY FROM (surgery_request.updated_at - surgery_request.created_at)))',
        'average_days',
      )
      .where({ ...where, status: SurgeryRequestStatus.CLOSED })
      .getRawOne();

    return {
      average_days: result?.average_days
        ? parseFloat(parseFloat(result.average_days).toFixed(1))
        : 0,
    };
  }

  // ============================================================
  // Pendências — use PendencyValidatorService para validação completa
  // O método calculatePendencies abaixo é simplificado para uso em listagens
  // ============================================================

  calculatePendencies(surgeryRequest: any): {
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
      !!surgeryRequest.health_plan_id,
      !!procedure,
      documents.some((d: any) => d.type === DOCUMENT_KEYS.DOCTOR_REQUEST),
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
      .leftJoinAndSelect('sr.created_by', 'created_by')
      .where('sr.status NOT IN (:...terminalStatuses)', { terminalStatuses })
      .andWhere(
        `sr.last_status_changed_at IS NOT NULL AND sr.last_status_changed_at <= NOW() - INTERVAL '1 day' * :minDays`,
        { minDays },
      )
      .andWhere('sr.deleted_at IS NULL')
      .getMany();
  }
}
