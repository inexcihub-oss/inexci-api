import { FindOptionsWhere, ILike, ObjectLiteral } from 'typeorm';
import { BaseRepository } from './base.repository';

export interface OwnedCatalogRecord {
  id: string;
  ownerId: string;
  name: string;
  deletedAt?: Date | null;
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export abstract class OwnedCatalogRepository<
  T extends ObjectLiteral & OwnedCatalogRecord,
> extends BaseRepository<T> {
  findMany(
    where: FindOptionsWhere<T> | FindOptionsWhere<T>[],
    skip?: number,
    take?: number,
  ): Promise<T[]> {
    return this.repository.find({
      where,
      skip,
      take,
      order: { name: 'ASC' } as never,
    });
  }

  findByOwnerId(ownerId: string): Promise<T[]> {
    return this.repository.find({
      where: { ownerId } as FindOptionsWhere<T>,
      order: { name: 'ASC' } as never,
    });
  }

  findByNameIncludingDeleted(ownerId: string, name: string): Promise<T | null> {
    const trimmed = name.trim();
    if (!trimmed) return Promise.resolve(null);

    return this.repository.findOne({
      where: {
        ownerId,
        name: ILike(escapeLikePattern(trimmed)),
      } as FindOptionsWhere<T>,
      withDeleted: true,
      order: { deletedAt: { direction: 'ASC', nulls: 'FIRST' } } as never,
    });
  }
}
