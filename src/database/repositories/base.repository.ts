import {
  Repository,
  FindOptionsWhere,
  DeepPartial,
  ObjectLiteral,
  QueryDeepPartialEntity,
} from 'typeorm';
import { traceInstanceMethods } from '../../shared/logging/trace.decorator';

interface HasId {
  id: string;
}

export abstract class BaseRepository<T extends ObjectLiteral & HasId> {
  constructor(protected readonly repository: Repository<T>) {
    traceInstanceMethods(this, {
      exclude: ['getRepository'],
    });
  }

  findOne(where: FindOptionsWhere<T>): Promise<T | null> {
    return this.repository.findOne({ where });
  }

  findMany(
    where: FindOptionsWhere<T> | FindOptionsWhere<T>[],
    skip?: number,
    take?: number,
  ): Promise<T[]> {
    return this.repository.find({ where, skip, take });
  }

  total(where: FindOptionsWhere<T> | FindOptionsWhere<T>[]): Promise<number> {
    return this.repository.count({ where });
  }

  create(data: DeepPartial<T>): Promise<T> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async update(id: string, data: DeepPartial<T>): Promise<T | null> {
    await this.repository.update(id, data as QueryDeepPartialEntity<T>);
    return this.findOne({ id } as FindOptionsWhere<T>);
  }

  async delete(id: string): Promise<void> {
    await this.softDelete(id);
  }

  async softDelete(id: string): Promise<void> {
    if (this.repository.metadata.deleteDateColumn) {
      await this.repository.softDelete(id);
      return;
    }

    await this.repository.delete(id);
  }

  async bulkSoftDelete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    if (this.repository.metadata.deleteDateColumn) {
      await this.repository.softDelete(ids);
      return;
    }

    await this.repository.delete(ids);
  }

  async restore(id: string): Promise<void> {
    if (this.repository.metadata.deleteDateColumn) {
      await this.repository.restore(id);
    }
  }

  getRepository(): Repository<T> {
    return this.repository;
  }
}
