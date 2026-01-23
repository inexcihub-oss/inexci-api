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
    // PostgreSQL: Ajustada query raw
    return await this.dataSource.query(`
        SELECT COUNT(*)::int as total, u.name FROM surgery_request sr
        INNER JOIN "user" u ON u.id = sr.hospital_id
        ${where}
        GROUP BY sr.hospital_id, u.name
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
    // PostgreSQL: Ajustada query raw
    return await this.dataSource.query(`
        SELECT COUNT(*)::int as total, health_plan_id FROM surgery_request
        ${where}
        GROUP BY health_plan_id
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
      .leftJoinAndSelect('surgery_request.responsible', 'responsible')
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

    return await queryBuilder.getOne();
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
      .leftJoinAndSelect('surgery_request.responsible', 'responsible')
      .leftJoinAndSelect('surgery_request.patient', 'patient')
      .leftJoinAndSelect('surgery_request.procedures', 'procedures')
      .leftJoinAndSelect('procedures.procedure', 'procedure')
      .leftJoinAndSelect('surgery_request.status_updates', 'status_updates')
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
        'surgery_request.protocol',
        'responsible.id',
        'responsible.name',
        'patient.id',
        'patient.name',
        'patient.email',
        'procedures.id',
        'procedures.quantity',
        'procedure.id',
        'procedure.name',
        'procedure.tuss_code',
      ]);

    // Limitando status_updates a 1
    const results = await queryBuilder.getRawAndEntities();

    return results.entities.map((entity: any) => ({
      ...entity,
      status_updates: entity.status_updates?.slice(0, 1) || [],
    }));
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
}
