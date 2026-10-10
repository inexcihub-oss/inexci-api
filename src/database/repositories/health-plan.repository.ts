import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HealthPlan } from '../entities/health-plan.entity';
import { OwnedCatalogRepository } from './owned-catalog.repository';

@Global()
@Injectable()
export class HealthPlanRepository extends OwnedCatalogRepository<HealthPlan> {
  constructor(
    @InjectRepository(HealthPlan)
    repository: Repository<HealthPlan>,
  ) {
    super(repository);
  }

  async findAll() {
    return await this.repository.find({ where: { active: true } });
  }
}
