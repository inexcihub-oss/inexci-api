import { Injectable, Logger } from '@nestjs/common';
import { FindManyHealthPlanDto } from './dto/find-many-health-plan.dto';
import { CreateHealthPlanDto } from './dto/create-health-plan.dto';
import { UpdateHealthPlanDto } from './dto/update-health-plan.dto';
import { FindOptionsWhere } from 'typeorm';
import { HealthPlanRepository } from 'src/database/repositories/health-plan.repository';
import { HealthPlan } from 'src/database/entities/health-plan.entity';
import { AccessControlService } from 'src/shared/services/access-control.service';
import {
  bulkDeleteOwned,
  createOrRestoreByName,
  findOwnedOrFail,
  resolveCatalogOwnerId,
} from 'src/shared/catalog/owned-catalog.helpers';

const NAO_ENCONTRADO = 'Convênio não encontrado';

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

  async create(data: CreateHealthPlanDto, userId: string): Promise<HealthPlan> {
    const ownerId = await resolveCatalogOwnerId(
      this.accessControlService,
      userId,
    );

    const healthPlan = await createOrRestoreByName({
      repository: this.healthPlanRepository,
      ownerId,
      data: { ...data, active: true },
      conflictMessage: (nome) => `Já existe um convênio com o nome "${nome}"`,
      logger: this.logger,
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
    await this.findOwned(id, userId);
    this.logger.log(`Convênio atualizado: id=${id}`);
    return (await this.healthPlanRepository.update(id, data))!;
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.findOwned(id, userId);
    await this.healthPlanRepository.delete(id);
    this.logger.log(`Convênio soft-deleted: id=${id}`);
  }

  async bulkDelete(
    ids: string[],
    userId: string,
  ): Promise<{ deleted: number }> {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const result = await bulkDeleteOwned({
      repository: this.healthPlanRepository,
      ids,
      ownerId,
      notFoundMessage: 'Um ou mais convênios não foram encontrados.',
    });
    this.logger.log(`Convênios soft-deleted em lote: total=${result.deleted}`);
    return result;
  }

  private findOwned(id: string, userId: string): Promise<HealthPlan> {
    return findOwnedOrFail(
      this.healthPlanRepository,
      this.accessControlService,
      id,
      userId,
      NAO_ENCONTRADO,
    );
  }
}
