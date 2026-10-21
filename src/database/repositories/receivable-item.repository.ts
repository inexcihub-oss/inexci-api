import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { ReceivableItem } from '../entities/receivable-item.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class ReceivableItemRepository extends BaseRepository<ReceivableItem> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(ReceivableItem));
  }

  async insertMany(
    itens: Partial<ReceivableItem>[],
    manager: EntityManager,
  ): Promise<void> {
    if (itens.length === 0) return;
    const repo = manager.getRepository(ReceivableItem);
    await repo.save(itens.map((item) => repo.create(item)));
  }

  findActiveOfReceivable(
    itemId: string,
    receivableId: string,
    manager: EntityManager,
  ): Promise<ReceivableItem | null> {
    return manager.getRepository(ReceivableItem).findOne({
      where: { id: itemId, receivableId, cancelledAt: IsNull() },
    });
  }

  countActive(receivableId: string, manager: EntityManager): Promise<number> {
    return manager
      .getRepository(ReceivableItem)
      .count({ where: { receivableId, cancelledAt: IsNull() } });
  }

  async sumActiveTotal(
    receivableId: string,
    manager: EntityManager,
    exceptItemId?: string,
  ): Promise<string> {
    const qb = manager
      .getRepository(ReceivableItem)
      .createQueryBuilder('i')
      .select('COALESCE(SUM(i.total), 0)::numeric(12,2)', 'total')
      .where('i.receivableId = :receivableId', { receivableId })
      .andWhere('i.cancelledAt IS NULL');
    if (exceptItemId) qb.andWhere('i.id <> :exceptItemId', { exceptItemId });
    const linha = await qb.getRawOne<{ total: string | null }>();
    return linha?.total ?? '0.00';
  }

  async markCancelled(
    itemId: string,
    cancelledById: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager
      .getRepository(ReceivableItem)
      .update(itemId, { cancelledAt: new Date(), cancelledById });
  }

  async activeDescriptions(
    receivableIds: string[],
  ): Promise<Map<string, string>> {
    if (receivableIds.length === 0) return new Map();
    const linhas = await this.repository
      .createQueryBuilder('i')
      .select('i.receivable_id', 'receivableId')
      .addSelect(
        "string_agg(i.description, ', ' ORDER BY i.created_at)",
        'descricao',
      )
      .where('i.receivableId IN (:...receivableIds)', { receivableIds })
      .andWhere('i.cancelledAt IS NULL')
      .groupBy('i.receivable_id')
      .getRawMany<{ receivableId: string; descricao: string | null }>();
    return new Map(
      linhas.map((linha) => [linha.receivableId, linha.descricao ?? '']),
    );
  }
}
