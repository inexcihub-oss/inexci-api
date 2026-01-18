import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';

import { Pendency } from '../entities/pendency.entity';

@Global()
@Injectable()
export class PendencyRepository {
  constructor(
    @InjectRepository(Pendency)
    private readonly repository: Repository<Pendency>,
  ) {}

  async total(where: FindOptionsWhere<Pendency>): Promise<number> {
    return await this.repository.count({ where });
  }

  async findMany(
    where: FindOptionsWhere<Pendency>,
  ): Promise<Partial<Pendency>[]> {
    return await this.repository.find({
      where,
      relations: ['responsible'],
      select: {
        id: true,
        created_manually: true,
        name: true,
        key: true,
        description: true,
        created_at: true,
        concluded_at: true,
        responsible: {
          id: true,
          name: true,
        },
      },
    });
  }

  async create(data: Partial<Pendency>): Promise<Pendency> {
    const pendency = this.repository.create(data);
    return await this.repository.save(pendency);
  }

  async updateMany(
    where: FindOptionsWhere<Pendency>,
    data: Partial<Pendency>,
  ): Promise<void> {
    await this.repository.update(where, data);
  }

  async findOneSimple(
    where: FindOptionsWhere<Pendency>,
  ): Promise<Pendency | null> {
    return await this.repository.findOne({ where });
  }
}
