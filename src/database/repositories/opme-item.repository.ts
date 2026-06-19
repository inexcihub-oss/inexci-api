import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OpmeItem } from '../entities/opme-item.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class OpmeItemRepository extends BaseRepository<OpmeItem> {
  constructor(
    @InjectRepository(OpmeItem)
    repository: Repository<OpmeItem>,
  ) {
    super(repository);
  }

  findByIdWithSuppliers(id: string): Promise<OpmeItem | null> {
    return this.repository.findOne({
      where: { id },
      relations: ['suppliers', 'manufacturers'],
    });
  }

  saveWithSuppliers(opmeItem: OpmeItem): Promise<OpmeItem> {
    return this.repository.save(opmeItem);
  }

  async findSuppliedSurgeryRequestsBySupplierId(supplierId: string): Promise<
    Array<{
      surgeryRequestId: string;
      surgeryRequestProtocol: string | null;
      patientName: string | null;
      opmeItemId: string;
      opmeItemName: string;
      authorizedQuantity: number | null;
      quantity: number;
      updatedAt: Date;
    }>
  > {
    const rows = await this.repository
      .createQueryBuilder('opmeItem')
      .leftJoin('opmeItem.surgeryRequest', 'surgeryRequest')
      .leftJoin('surgeryRequest.patient', 'patient')
      .where('opmeItem.selectedSupplierId = :supplierId', { supplierId })
      .orderBy('opmeItem.updatedAt', 'DESC')
      .select([
        'surgeryRequest.id AS "surgeryRequestId"',
        'surgeryRequest.protocol AS "surgeryRequestProtocol"',
        'patient.name AS "patientName"',
        'opmeItem.id AS "opmeItemId"',
        'opmeItem.name AS "opmeItemName"',
        'opmeItem.authorizedQuantity AS "authorizedQuantity"',
        'opmeItem.quantity AS "quantity"',
        'opmeItem.updatedAt AS "updatedAt"',
      ])
      .getRawMany<{
        surgeryRequestId: string;
        surgeryRequestProtocol: string | null;
        patientName: string | null;
        opmeItemId: string;
        opmeItemName: string;
        authorizedQuantity: number | null;
        quantity: number;
        updatedAt: Date;
      }>();

    return rows;
  }
}
