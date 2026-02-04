import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';

import { HealthPlan } from '../entities/health-plan.entity';

@Global()
@Injectable()
export class HealthPlanRepository {
  constructor(
    @InjectRepository(HealthPlan)
    private readonly repository: Repository<HealthPlan>,
  ) {}

  async findAll() {
    return await this.repository.find({ where: { active: true } });
  }

  async findOne(where: FindOptionsWhere<HealthPlan>) {
    return await this.repository.findOne({ where });
  }

  async findMany(
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

  async total(
    where: FindOptionsWhere<HealthPlan> | FindOptionsWhere<HealthPlan>[],
  ): Promise<number> {
    return this.repository.count({ where });
  }

  async create(data: Partial<HealthPlan>) {
    const healthPlan = this.repository.create(data);
    return await this.repository.save(healthPlan);
  }

  async update(id: string, data: Partial<HealthPlan>) {
    await this.repository.update(id, data);
    return await this.findOne({ id });
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  async findByDoctorId(doctorId: string): Promise<HealthPlan[]> {
    return this.repository.find({
      where: { doctor_id: doctorId },
      order: { name: 'ASC' },
    });
  }
}
