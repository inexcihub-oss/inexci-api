import {
  Repository,
  FindOptionsWhere,
  DeepPartial,
  ObjectLiteral,
} from 'typeorm';

export abstract class BaseRepository<T extends ObjectLiteral> {
  constructor(protected readonly repository: Repository<T>) {}

  async findOne(where: FindOptionsWhere<T>): Promise<T | null> {
    return this.repository.findOne({ where });
  }

  async findMany(
    where: FindOptionsWhere<T> | FindOptionsWhere<T>[],
    skip?: number,
    take?: number,
  ): Promise<T[]> {
    return this.repository.find({ where, skip, take });
  }

  async total(
    where: FindOptionsWhere<T> | FindOptionsWhere<T>[],
  ): Promise<number> {
    return this.repository.count({ where });
  }

  async create(data: DeepPartial<T>): Promise<T> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async update(id: string, data: Partial<T>): Promise<T | null> {
    await this.repository.update(id, data as any);
    return this.findOne({ id } as any);
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  getRepository(): Repository<T> {
    return this.repository;
  }
}
