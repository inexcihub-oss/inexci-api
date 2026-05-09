import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FindManyHealthPlanDto } from './dto/find-many-health-plan.dto';
import { CreateHealthPlanDto } from './dto/create-health-plan.dto';
import { UpdateHealthPlanDto } from './dto/update-health-plan.dto';
import { FindOptionsWhere } from 'typeorm';
import { HealthPlanRepository } from 'src/database/repositories/health-plan.repository';
import { HealthPlan } from 'src/database/entities/health-plan.entity';
import { AccessControlService } from 'src/shared/services/access-control.service';

@Injectable()
export class HealthPlansService {
  private readonly logger = new Logger(HealthPlansService.name);
  constructor(
    private readonly healthPlanRepository: HealthPlanRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async findAll(query: FindManyHealthPlanDto, userId: string) {
    const ownerId = await this.accessControlService.getOwnerId(userId);

    const where: FindOptionsWhere<HealthPlan> = { ownerId };

    const [total, records] = await Promise.all([
      this.healthPlanRepository.total(where),
      this.healthPlanRepository.findMany(where, query.skip, query.take),
    ]);

    this.logger.debug(
      `findAll: ${total} convênios encontrados para userId=${userId}`,
    );
    return { total, records };
  }

  async findOne(id: string, userId: string): Promise<HealthPlan> {
    const healthPlan = await this.healthPlanRepository.findOne({ id });
    if (!healthPlan) throw new NotFoundException('Convênio não encontrado');
    await this.accessControlService.assertSameOwner(userId, healthPlan.ownerId);
    return healthPlan;
  }

  async create(data: CreateHealthPlanDto, userId: string): Promise<HealthPlan> {
    const ownerId = await this.accessControlService.getOwnerId(userId);

    const existing = await this.healthPlanRepository.findOne({
      name: data.name,
      ownerId,
    });
    if (existing) {
      throw new ConflictException(
        `Já existe um convênio com o nome "${data.name}"`,
      );
    }

    const healthPlan = await this.healthPlanRepository.create({
      ...data,
      ownerId,
      active: true,
    });
    this.logger.log(
      `Convênio criado: id=${healthPlan.id}, name=${healthPlan.name}`,
    );
    return healthPlan;
  }

  async update(
    id: string,
    data: UpdateHealthPlanDto,
    userId: string,
  ): Promise<HealthPlan> {
    const healthPlan = await this.healthPlanRepository.findOne({ id });
    if (!healthPlan) throw new NotFoundException('Convênio não encontrado');
    await this.accessControlService.assertSameOwner(userId, healthPlan.ownerId);
    this.logger.log(`Convênio atualizado: id=${id}`);
    return this.healthPlanRepository.update(id, data);
  }

  async delete(id: string, userId: string): Promise<void> {
    const healthPlan = await this.healthPlanRepository.findOne({ id });
    if (!healthPlan) throw new NotFoundException('Convênio não encontrado');
    await this.accessControlService.assertSameOwner(userId, healthPlan.ownerId);
    await this.healthPlanRepository.delete(id);
    this.logger.log(`Convênio soft-deleted: id=${id}`);
  }
}
