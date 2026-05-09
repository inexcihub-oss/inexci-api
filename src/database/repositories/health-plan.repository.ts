import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { HealthPlan } from '../entities/health-plan.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class HealthPlanRepository extends BaseRepository<HealthPlan> {
  constructor(
    @InjectRepository(HealthPlan)
    repository: Repository<HealthPlan>,
  ) {
    super(repository);
  }

  async findAll() {
    return await this.repository.find({ where: { active: true } });
  }

  findMany(
    where: FindOptionsWhere<HealthPlan> | FindOptionsWhere<HealthPlan>[],
    skip?: number,
    take?: number,
  ): Promise<HealthPlan[]> {
    return this.repository.find({
      where,
      skip,
      take,
      order: { name: 'ASC' },
    });
  }

  /**
   * Lista convênios cadastrados pela clínica (ownerId).
   */
  findByOwnerId(ownerId: string): Promise<HealthPlan[]> {
    return this.repository.find({
      where: { ownerId },
      order: { name: 'ASC' },
    });
  }
}
