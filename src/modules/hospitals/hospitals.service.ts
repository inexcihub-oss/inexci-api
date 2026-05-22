import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FindManyHospitalDto } from './dto/find-many-hospital.dto';
import { CreateHospitalDto } from './dto/create-hospital.dto';
import { UpdateHospitalDto } from './dto/update-hospital.dto';
import { HospitalRepository } from 'src/database/repositories/hospital.repository';
import { FindOptionsWhere, In } from 'typeorm';
import { Hospital } from 'src/database/entities/hospital.entity';
import { AccessControlService } from 'src/shared/services/access-control.service';

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

  async findOne(id: string, userId: string): Promise<Hospital> {
    const hospital = await this.hospitalRepository.findOne({ id });
    if (!hospital) throw new NotFoundException('Hospital não encontrado');

    await this.accessControlService.assertSameOwner(userId, hospital.ownerId);
    return hospital;
  }

  async create(data: CreateHospitalDto, userId: string): Promise<Hospital> {
    const ownerId = await this.accessControlService.getOwnerId(userId);

    const existing = await this.hospitalRepository.findOne({
      name: data.name,
      ownerId,
    });
    if (existing) {
      throw new ConflictException(
        `Já existe um hospital com o nome "${data.name}"`,
      );
    }

    return this.hospitalRepository.create({
      ...data,
      ownerId,
      active: true,
    });
  }

  async update(
    id: string,
    data: UpdateHospitalDto,
    userId: string,
  ): Promise<Hospital> {
    const hospital = await this.hospitalRepository.findOne({ id });
    if (!hospital) throw new NotFoundException('Hospital não encontrado');
    await this.accessControlService.assertSameOwner(userId, hospital.ownerId);
    return (await this.hospitalRepository.update(id, data))!;
  }

  async delete(id: string, userId: string): Promise<void> {
    const hospital = await this.hospitalRepository.findOne({ id });
    if (!hospital) throw new NotFoundException('Hospital não encontrado');
    await this.accessControlService.assertSameOwner(userId, hospital.ownerId);
    await this.hospitalRepository.delete(id);
  }

  async bulkDelete(
    ids: string[],
    userId: string,
  ): Promise<{ deleted: number }> {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const uniqueIds = [...new Set(ids)];

    const hospitals = await this.hospitalRepository.findMany({
      id: In(uniqueIds),
      ownerId,
    });

    if (hospitals.length !== uniqueIds.length) {
      throw new NotFoundException(
        'Um ou mais hospitais não foram encontrados.',
      );
    }

    await this.hospitalRepository.getRepository().softDelete(uniqueIds);
    this.logger.log(
      `Hospitais soft-deleted em lote: total=${uniqueIds.length}`,
    );

    return { deleted: uniqueIds.length };
  }
}
