import { Injectable, Logger } from '@nestjs/common';
import { FindManyHospitalDto } from './dto/find-many-hospital.dto';
import { CreateHospitalDto } from './dto/create-hospital.dto';
import { UpdateHospitalDto } from './dto/update-hospital.dto';
import { HospitalRepository } from 'src/database/repositories/hospital.repository';
import { FindOptionsWhere } from 'typeorm';
import {
  HOSPITAL_NOME_UNICO,
  Hospital,
} from 'src/database/entities/hospital.entity';
import { AccessControlService } from 'src/shared/services/access-control.service';
import {
  bulkDeleteOwned,
  createOrRestoreByName,
  findOwnedOrFail,
  resolveCatalogOwnerId,
  updateWithUniqueName,
} from 'src/shared/catalog/owned-catalog.helpers';

const conflitoDeNome = (nome: string) =>
  `Já existe um hospital com o nome "${nome}"`;

const NAO_ENCONTRADO = 'Hospital não encontrado';

@Injectable()
export class HospitalsService {
  private readonly logger = new Logger(HospitalsService.name);
  constructor(
    private readonly hospitalRepository: HospitalRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async findAll(query: FindManyHospitalDto, userId: string) {
    const ownerId = await this.accessControlService.getOwnerId(userId);

    const where: FindOptionsWhere<Hospital> = { ownerId };

    const [total, records] = await Promise.all([
      this.hospitalRepository.total(where),
      this.hospitalRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }

  async create(data: CreateHospitalDto, userId: string): Promise<Hospital> {
    const ownerId = await resolveCatalogOwnerId(
      this.accessControlService,
      userId,
    );

    return createOrRestoreByName({
      repository: this.hospitalRepository,
      ownerId,
      data: { ...data, active: true },
      conflictMessage: conflitoDeNome,
      uniqueIndex: HOSPITAL_NOME_UNICO,
      logger: this.logger,
    });
  }

  async update(
    id: string,
    data: UpdateHospitalDto,
    userId: string,
  ): Promise<Hospital> {
    await this.findOwned(id, userId);
    return updateWithUniqueName({
      repository: this.hospitalRepository,
      id,
      data,
      uniqueIndex: HOSPITAL_NOME_UNICO,
      conflictMessage: conflitoDeNome,
    });
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.findOwned(id, userId);
    await this.hospitalRepository.delete(id);
  }

  async bulkDelete(
    ids: string[],
    userId: string,
  ): Promise<{ deleted: number }> {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const result = await bulkDeleteOwned({
      repository: this.hospitalRepository,
      ids,
      ownerId,
      notFoundMessage: 'Um ou mais hospitais não foram encontrados.',
    });
    this.logger.log(`Hospitais soft-deleted em lote: total=${result.deleted}`);
    return result;
  }

  private findOwned(id: string, userId: string): Promise<Hospital> {
    return findOwnedOrFail(
      this.hospitalRepository,
      this.accessControlService,
      id,
      userId,
      NAO_ENCONTRADO,
    );
  }
}
