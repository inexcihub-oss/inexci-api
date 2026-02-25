import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, DataSource } from 'typeorm';

import { SurgeryRequest } from '../entities/surgery-request.entity';

@Global()
@Injectable()
export class SurgeryRequestRepository {
  constructor(
    @InjectRepository(SurgeryRequest)
    private readonly repository: Repository<SurgeryRequest>,
    private readonly dataSource: DataSource,
  ) {}

  async totalByHospital(where: string) {
    // PostgreSQL: Ajustada query raw com JOIN na tabela hospital
    return await this.dataSource.query(`
        SELECT COUNT(*)::int as total, 
               sr.hospital_id,
               COALESCE(h.name, 'Sem Hospital') as hospital_name
        FROM surgery_request sr
        LEFT JOIN hospital h ON h.id = sr.hospital_id
        ${where}
        GROUP BY sr.hospital_id, h.name
        ORDER BY total DESC
      `);
  }

  async totalByStatus(where: string) {
    // PostgreSQL: Ajustada query raw com alias
    return await this.dataSource.query(`
        SELECT COUNT(*)::int as total, sr.status 
        FROM surgery_request sr
        ${where}
        GROUP BY sr.status
        ORDER BY total DESC
      `);
  }

  async totalByHealthPlan(where: string) {
    // PostgreSQL: Ajustada query raw com LEFT JOIN na tabela health_plan
    return await this.dataSource.query(`
        SELECT COUNT(*)::int as total, 
               sr.health_plan_id, 
               COALESCE(hp.name, 'Sem Convênio') as health_plan_name
        FROM surgery_request sr
        LEFT JOIN health_plan hp ON hp.id = sr.health_plan_id
        ${where}
        GROUP BY sr.health_plan_id, hp.name
        ORDER BY total DESC
      `);
  }

  async sumInvoiced(where: FindOptionsWhere<SurgeryRequest>) {
    const result = await this.dataSource.query(
      `
      SELECT 
        SUM(srb.invoice_value)::numeric AS invoiced_value,
        SUM(srb.received_value)::numeric AS received_value
      FROM surgery_request sr
      LEFT JOIN surgery_request_billing srb ON srb.surgery_request_id = sr.id
      WHERE sr.doctor_id = $1
    `,
      [(where as any).doctor_id || null],
    );

    return {
      _sum: {
        invoiced_value: result?.[0]?.invoiced_value || null,
        received_value: result?.[0]?.received_value || null,
      },
    };
  }

  async total(where: FindOptionsWhere<SurgeryRequest>): Promise<number> {
    return await this.repository.count({ where });
  }

  async findOne(
    where: FindOptionsWhere<SurgeryRequest>,
    whereChat?: any, // Será filtrado posteriormente
    whereQuotation?: any, // Será filtrado posteriormente
  ): Promise<SurgeryRequest | null> {
    const queryBuilder = this.repository
      .createQueryBuilder('surgery_request')
      .leftJoinAndSelect('surgery_request.created_by', 'created_by')
      .leftJoinAndSelect('surgery_request.manager', 'manager')
      .leftJoinAndSelect('surgery_request.doctor', 'doctor')
      .leftJoinAndSelect('doctor.user', 'doctor_user')
      .leftJoinAndSelect('surgery_request.patient', 'patient')
      .leftJoinAndSelect('surgery_request.hospital', 'hospital')
      .leftJoinAndSelect('surgery_request.health_plan', 'health_plan')
      .leftJoinAndSelect('surgery_request.opme_items', 'opme_items')
      .leftJoinAndSelect('surgery_request.procedure', 'procedure')
      .leftJoinAndSelect('surgery_request.tuss_items', 'tuss_items')
      .leftJoinAndSelect('surgery_request.documents', 'documents')
      .leftJoinAndSelect('documents.creator', 'documents_creator')
      .leftJoinAndSelect('surgery_request.quotations', 'quotations')
      .leftJoinAndSelect('quotations.supplier', 'quotations_supplier')
      .leftJoinAndSelect('surgery_request.status_updates', 'status_updates')
      .leftJoinAndSelect('surgery_request.chats', 'chats')
      .leftJoinAndSelect('chats.user', 'chats_user')
      .leftJoinAndSelect('chats.messages', 'messages')
      // Relações adicionadas para suporte ao frontend (Fase 9)
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
      } as any;
    }

    return entity;
  }

  async findOneSimple(
    where: FindOptionsWhere<SurgeryRequest>,
  ): Promise<SurgeryRequest | null> {
    return await this.repository.findOne({ where });
  }

  async findMany(
    where: FindOptionsWhere<SurgeryRequest>,
    skip: number,
    take: number,
  ): Promise<any[]> {
    const queryBuilder = this.repository
      .createQueryBuilder('surgery_request')
      .leftJoinAndSelect('surgery_request.created_by', 'created_by')
      .leftJoinAndSelect('surgery_request.manager', 'manager')
      .leftJoinAndSelect('surgery_request.patient', 'patient')
      .leftJoinAndSelect('surgery_request.health_plan', 'health_plan')
      .leftJoinAndSelect('surgery_request.procedure', 'procedure')
      .leftJoinAndSelect('surgery_request.tuss_items', 'tuss_items')
      .leftJoinAndSelect('surgery_request.status_updates', 'status_updates')
      .leftJoin('surgery_request.chats', 'chats')
      .leftJoin('chats.messages', 'messages')
      .leftJoin('surgery_request.documents', 'documents')
      .where(where)
      .orderBy('surgery_request.created_at', 'DESC')
      .skip(skip)
      .take(take)
      .select([
        'surgery_request.id',
        'surgery_request.status',
        'surgery_request.health_plan_id',
        'surgery_request.created_at',
        'surgery_request.is_indication',
        'surgery_request.indication_name',
        'surgery_request.date_call',
        'surgery_request.deadline',
        'surgery_request.protocol',
        'surgery_request.priority',
        'created_by.id',
        'created_by.name',
        'manager.id',
        'manager.name',
        'manager.email',
        'patient.id',
        'patient.name',
        'patient.email',
        'health_plan.id',
        'health_plan.name',
        'procedure.id',
        'procedure.name',
      ])
      .addSelect('COUNT(DISTINCT messages.id)', 'messagesCount')
      .addSelect('COUNT(DISTINCT documents.id)', 'attachmentsCount')
      .groupBy('surgery_request.id')
      .addGroupBy('created_by.id')
      .addGroupBy('manager.id')
      .addGroupBy('patient.id')
      .addGroupBy('health_plan.id')
      .addGroupBy('procedure.id')
      .addGroupBy('status_updates.id');

    // Limitando status_updates a 1
    const results = await queryBuilder.getRawAndEntities();

    // Para cada entidade, precisamos buscar os documentos para calcular pendências
    const entitiesWithDocuments = await Promise.all(
      results.entities.map(async (entity: any) => {
        const fullEntity = await this.repository.findOne({
          where: { id: entity.id },
          relations: ['documents', 'patient', 'procedure'],
        });
        return fullEntity || entity;
      }),
    );

    return results.entities.map((entity: any, index: number) => {
      const fullEntity = entitiesWithDocuments[index];
      const pendencies = this.calculatePendencies(fullEntity);

      return {
        ...entity,
        status_updates: entity.status_updates?.slice(0, 1) || [],
        messagesCount: parseInt(results.raw[index]?.messagesCount || '0'),
        attachmentsCount: parseInt(results.raw[index]?.attachmentsCount || '0'),
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
      .where({ ...where, status: 9 }) // Status finalizada
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
      documents.some((d: any) => d.type === 'doctorRequest'),
    ];

    const completedCount = checks.filter(Boolean).length;
    const totalCount = checks.length;
    const pendingCount = totalCount - completedCount;

    return { pendingCount, completedCount, totalCount };
  }
}
