import {
  Repository,
  FindOptionsWhere,
  DeepPartial,
  ObjectLiteral,
  QueryDeepPartialEntity,
} from 'typeorm';

/** Interface que garante a presença de campo `id` para operações de update/findOne por id */
interface HasId {
  id: string;
}

export abstract class BaseRepository<T extends ObjectLiteral & HasId> {
  constructor(protected readonly repository: Repository<T>) {}

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

  total(
    where: FindOptionsWhere<T> | FindOptionsWhere<T>[],
  ): Promise<number> {
    return this.repository.count({ where });
  }

  create(data: DeepPartial<T>): Promise<T> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async update(id: string, data: QueryDeepPartialEntity<T>): Promise<T | null> {
    await this.repository.update(id, data);
    return this.findOne({ id } as FindOptionsWhere<T>);
  }

  async delete(id: string): Promise<void> {
    await this.repository.softDelete(id);
  }

  getRepository(): Repository<T> {
    return this.repository;
  }
}
