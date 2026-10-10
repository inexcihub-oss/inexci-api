import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FindOptionsWhere } from 'typeorm';
import { Clinic } from 'src/database/entities/clinic.entity';
import { ClinicRepository } from 'src/database/repositories/clinic.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import {
  emptyBusinessHours,
  normalizeBusinessHours,
} from 'src/shared/business-hours/business-hours.util';
import { CreateClinicDto } from './dto/create-clinic.dto';
import { UpdateClinicDto } from './dto/update-clinic.dto';
import { FindManyClinicDto } from './dto/find-many-clinic.dto';
import { bulkDeleteOwned } from 'src/shared/catalog/owned-catalog.helpers';

@Injectable()
export class ClinicsService {
  private readonly logger = new Logger(ClinicsService.name);

  constructor(
    private readonly clinicRepository: ClinicRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  private comGradeNormalizada(clinic: Clinic): Clinic {
    clinic.businessHours = normalizeBusinessHours(clinic.businessHours);
    return clinic;
  }

  async findAll(query: FindManyClinicDto, userId: string) {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const where: FindOptionsWhere<Clinic> = { ownerId };

    const [total, records] = await Promise.all([
      this.clinicRepository.total(where),
      this.clinicRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records: records.map((c) => this.comGradeNormalizada(c)) };
  }

  async findOne(id: string, userId: string): Promise<Clinic> {
    const clinic = await this.clinicRepository.findOne({ id });
    if (!clinic) throw new NotFoundException('Clínica não encontrada');

    await this.accessControlService.assertSameOwner(userId, clinic.ownerId);
    return this.comGradeNormalizada(clinic);
  }

  async create(data: CreateClinicDto, userId: string): Promise<Clinic> {
    const ownerId = await this.accessControlService.getOwnerId(userId);

    const existing = await this.clinicRepository.findOne({
      name: data.name,
      ownerId,
    });
    if (existing) {
      throw new ConflictException(
        `Já existe uma clínica com o nome "${data.name}"`,
      );
    }

    return this.clinicRepository.create({
      ...data,
      businessHours: data.businessHours
        ? normalizeBusinessHours(data.businessHours)
        : emptyBusinessHours(),
      ownerId,
      active: true,
    });
  }

  async update(
    id: string,
    data: UpdateClinicDto,
    userId: string,
  ): Promise<Clinic> {
    const clinic = await this.clinicRepository.findOne({ id });
    if (!clinic) throw new NotFoundException('Clínica não encontrada');
    await this.accessControlService.assertSameOwner(userId, clinic.ownerId);

    const dados: Partial<Clinic> = { ...data };
    if (data.businessHours !== undefined) {
      dados.businessHours = normalizeBusinessHours(data.businessHours);
    }

    return (await this.clinicRepository.update(id, dados))!;
  }

  async delete(id: string, userId: string): Promise<void> {
    const clinic = await this.clinicRepository.findOne({ id });
    if (!clinic) throw new NotFoundException('Clínica não encontrada');
    await this.accessControlService.assertSameOwner(userId, clinic.ownerId);

    await this.clinicRepository.delete(id);
  }

  async bulkDelete(
    ids: string[],
    userId: string,
  ): Promise<{ deleted: number }> {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const result = await bulkDeleteOwned({
      repository: this.clinicRepository,
      ids,
      ownerId,
      notFoundMessage: 'Uma ou mais clínicas não foram encontradas.',
    });
    this.logger.log(`Clínicas soft-deleted em lote: total=${result.deleted}`);
    return result;
  }
}
