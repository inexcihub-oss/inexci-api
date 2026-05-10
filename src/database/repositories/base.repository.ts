import {
  Repository,
  FindOptionsWhere,
  DeepPartial,
  ObjectLiteral,
  QueryDeepPartialEntity,
} from 'typeorm';
import { traceInstanceMethods } from '../../shared/logging/trace.decorator';

/** Interface que garante a presença de campo `id` para operações de update/findOne por id */
interface HasId {
  id: string;
}

export abstract class BaseRepository<T extends ObjectLiteral & HasId> {
  constructor(protected readonly repository: Repository<T>) {
    // Envolve os métodos da instância (incluindo os sobrescritos pelas
    // subclasses como UserRepository) em um wrapper de trace. Cada chamada
    // emite uma linha entry/exit no logger 'Trace' com requestId/userId
    // herdados do AsyncLocalStorage. Cobre os 29 repositórios sem precisar
    // decorar cada um manualmente.
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
