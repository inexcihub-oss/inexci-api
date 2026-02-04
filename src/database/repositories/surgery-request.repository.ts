import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, DataSource } from 'typeorm';

import { SurgeryRequest } from '../entities/surgery-request.entity';
import surgeryRequestStatusesCommon from 'src/common/surgery-request-statuses.common';
import PendencyKeys from 'src/common/pendency-keys.common';

@Global()
@Injectable()
export class SurgeryRequestRepository {
  constructor(
    @InjectRepository(SurgeryRequest)
    private readonly repository: Repository<SurgeryRequest>,
    private readonly dataSource: DataSource,
  ) {}

  async totalByHospital(where: string) {
    // PostgreSQL: Ajustada query raw com JOIN na tabela user
    return await this.dataSource.query(`
        SELECT COUNT(*)::int as total, 
               sr.hospital_id,
               COALESCE(u.name, 'Sem Hospital') as hospital_name
        FROM surgery_request sr
        LEFT JOIN "user" u ON u.id = sr.hospital_id
        ${where}
        GROUP BY sr.hospital_id, u.name
        ORDER BY total DESC
      `);
  }

  async totalByStatus(where: string) {
    // PostgreSQL: Ajustada query raw
    return await this.dataSource.query(`
        SELECT COUNT(*)::int as total, status FROM surgery_request
        ${where}
        GROUP BY status
      `);
  }

  async totalByHealthPlan(where: string) {
    // PostgreSQL: Ajustada query raw com LEFT JOIN na tabela user
    return await this.dataSource.query(`
        SELECT COUNT(*)::int as total, 
               sr.health_plan_id, 
               COALESCE(u.name, 'Sem Convênio') as health_plan_name
        FROM surgery_request sr
        LEFT JOIN "user" u ON u.id = sr.health_plan_id
        ${where}
        GROUP BY sr.health_plan_id, u.name
        ORDER BY total DESC
      `);
  }

  async sumInvoiced(where: FindOptionsWhere<SurgeryRequest>) {
    const result = await this.repository
      .createQueryBuilder('surgery_request')
      .select('SUM(surgery_request.invoiced_value)', 'invoiced_value')
      .addSelect('SUM(surgery_request.received_value)', 'received_value')
      .where(where)
      .getRawOne();

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
    whereChat?: any, // Será filtrado posteriormente
    whereQuotation?: any, // Será filtrado posteriormente
  ): Promise<SurgeryRequest | null> {
    const queryBuilder = this.repository
      .createQueryBuilder('surgery_request')
      .leftJoinAndSelect('surgery_request.created_by', 'created_by')
      .leftJoinAndSelect('surgery_request.patient', 'patient')
      .leftJoinAndSelect('surgery_request.hospital', 'hospital')
      .leftJoinAndSelect('surgery_request.cid', 'cid')
      .leftJoinAndSelect('surgery_request.health_plan', 'health_plan')
      .leftJoinAndSelect('surgery_request.opme_items', 'opme_items')
      .leftJoinAndSelect('surgery_request.procedures', 'procedures')
      .leftJoinAndSelect('procedures.procedure', 'procedure')
      .leftJoinAndSelect('surgery_request.documents', 'documents')
      .leftJoinAndSelect('documents.creator', 'documents_creator')
      .leftJoinAndSelect('surgery_request.quotations', 'quotations')
      .leftJoinAndSelect('quotations.supplier', 'quotations_supplier')
      .leftJoinAndSelect('surgery_request.status_updates', 'status_updates')
      .leftJoinAndSelect('surgery_request.chats', 'chats')
      .leftJoinAndSelect('chats.user', 'chats_user')
      .leftJoinAndSelect('chats.messages', 'messages')
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
      .leftJoinAndSelect('surgery_request.patient', 'patient')
      .leftJoinAndSelect('surgery_request.health_plan', 'health_plan')
      .leftJoinAndSelect('surgery_request.procedures', 'procedures')
      .leftJoinAndSelect('procedures.procedure', 'procedure')
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
        'patient.id',
        'patient.name',
        'patient.email',
        'health_plan.id',
        'health_plan.name',
        'procedures.id',
        'procedures.quantity',
        'procedure.id',
        'procedure.name',
        'procedure.tuss_code',
      ])
      .addSelect('COUNT(DISTINCT messages.id)', 'messagesCount')
      .addSelect('COUNT(DISTINCT documents.id)', 'attachmentsCount')
      .groupBy('surgery_request.id')
      .addGroupBy('created_by.id')
      .addGroupBy('patient.id')
      .addGroupBy('health_plan.id')
      .addGroupBy('procedures.id')
      .addGroupBy('procedure.id')
      .addGroupBy('status_updates.id');

    // Limitando status_updates a 1
    const results = await queryBuilder.getRawAndEntities();

    // Para cada entidade, precisamos buscar os documentos para calcular pendências
    const entitiesWithDocuments = await Promise.all(
      results.entities.map(async (entity: any) => {
        const fullEntity = await this.repository.findOne({
          where: { id: entity.id },
          relations: ['documents', 'patient', 'procedures'],
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
    id: number,
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
      .select('DATE(surgery_request.created_at)', 'date')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(surgery_request.invoiced_value)', 'invoiced_value')
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

  /**
   * Obtém a configuração de status pelo valor numérico
   */
  private getStatusConfigByValue(value: number) {
    for (const key in surgeryRequestStatusesCommon) {
      const config = surgeryRequestStatusesCommon[key];
      if (config.value === value) {
        return config;
      }
    }
    return null;
  }

  /**
   * Verifica se uma pendência está completa
   */
  private checkPendencyComplete(
    surgeryRequest: any,
    pendencyKey: string,
  ): boolean {
    const patient = surgeryRequest.patient;
    const documents = surgeryRequest.documents || [];
    const procedures = surgeryRequest.procedures || [];
    const opmeItems = surgeryRequest.opme_items || [];
    const quotations = surgeryRequest.quotations || [];

    const hasDocument = (type: string) =>
      documents.some((d: any) => d.document_key === type);

    switch (pendencyKey) {
      case PendencyKeys.patientData:
        return !!(patient?.name && patient?.email && patient?.phone);
      case PendencyKeys.hospitalData:
        return !!surgeryRequest.hospital_id;
      case PendencyKeys.healthPlanData:
        return !!(
          surgeryRequest.health_plan_id &&
          surgeryRequest.health_plan_registration
        );
      case PendencyKeys.insertTuss:
        return procedures.length > 0;
      case PendencyKeys.insertOpme:
        return opmeItems.length > 0;
      case PendencyKeys.diagnosisData:
        return !!(surgeryRequest.cid_id && surgeryRequest.diagnosis);
      case PendencyKeys.medicalReport:
        return !!(
          surgeryRequest.medical_report || hasDocument('medical_report')
        );
      case PendencyKeys.documents.personalDocument:
        return hasDocument('personal_document');
      case PendencyKeys.documents.doctorRequest:
        return hasDocument('doctor_request');
      case PendencyKeys.quotation1:
        return quotations.length >= 1;
      case PendencyKeys.quotation2:
        return quotations.length >= 2;
      case PendencyKeys.quotation3:
        return quotations.length >= 3;
      case PendencyKeys.hospitalProtocol:
        return !!surgeryRequest.hospital_protocol;
      case PendencyKeys.healthPlanProtocol:
        return !!surgeryRequest.health_plan_protocol;
      case PendencyKeys.waitAnalysis:
        return false;
      case PendencyKeys.defineDates:
        return !!(
          surgeryRequest.date_options &&
          Array.isArray(surgeryRequest.date_options) &&
          surgeryRequest.date_options.length >= 1
        );
      case PendencyKeys.patientChooseDate:
        return surgeryRequest.selected_date_index !== null;
      case PendencyKeys.documents.authorizationGuide:
        return hasDocument('authorization_guide');
      case PendencyKeys.confirmSurgery:
        return !!surgeryRequest.surgery_date;
      case PendencyKeys.surgeryDescription:
        return !!surgeryRequest.surgery_description;
      case PendencyKeys.invoicedValue:
        return !!surgeryRequest.invoiced_value;
      case PendencyKeys.documents.invoiceProtocol:
        return hasDocument('invoice_protocol');
      case PendencyKeys.registerReceipt:
        return !!(
          surgeryRequest.received_value && surgeryRequest.received_date
        );
      default:
        if (pendencyKey.startsWith('document_')) {
          const docType = pendencyKey.replace('document_', '');
          return hasDocument(docType);
        }
        return false;
    }
  }

  /**
   * Calcula pendências APENAS do status atual (não acumula status anteriores)
   */
  calculatePendencies(surgeryRequest: any): {
    pendingCount: number;
    completedCount: number;
    totalCount: number;
  } {
    const currentStatus = surgeryRequest.status;
    const statusConfig = this.getStatusConfigByValue(currentStatus);

    if (!statusConfig) {
      return {
        pendingCount: 0,
        completedCount: 0,
        totalCount: 0,
      };
    }

    let completedCount = 0;
    let pendingCount = 0;

    // Validar apenas as pendências do status atual
    for (const defaultPendency of statusConfig.defaultPendencies) {
      const isComplete = this.checkPendencyComplete(
        surgeryRequest,
        defaultPendency.key,
      );

      if (isComplete) {
        completedCount++;
      } else if (!defaultPendency.optional) {
        // Só conta como pendente se não for opcional
        pendingCount++;
      }
    }

    const totalCount = statusConfig.defaultPendencies.length;

    return {
      pendingCount,
      completedCount,
      totalCount,
    };
  }
}
