import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FindOptionsWhere, In } from 'typeorm';
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

@Injectable()
export class ClinicsService {
  private readonly logger = new Logger(ClinicsService.name);

  constructor(
    private readonly clinicRepository: ClinicRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  /**
   * Garante os sete dias na saída. Sem isso, o consumidor precisaria de
   * `hours.mon ?? []` em todo acesso — e a coluna nasce com `{}` por default.
   */
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

    // A grade é substituída inteira quando vem no payload; ausente, fica como
    // está. Merge parcial de dias não existe de propósito — o editor sempre
    // manda a semana completa, e um merge esconderia a remoção de um bloco.
    const dados: Partial<Clinic> = { ...data } as Partial<Clinic>;
    if (data.businessHours !== undefined) {
      dados.businessHours = normalizeBusinessHours(data.businessHours);
    }

    return (await this.clinicRepository.update(id, dados))!;
  }

  async delete(id: string, userId: string): Promise<void> {
    const clinic = await this.clinicRepository.findOne({ id });
    if (!clinic) throw new NotFoundException('Clínica não encontrada');
    await this.accessControlService.assertSameOwner(userId, clinic.ownerId);

    // `BaseRepository.delete` já faz soft delete quando a entidade tem
    // `deletedAt` — a consulta antiga continua apontando para a clínica.
    await this.clinicRepository.delete(id);
  }

  async bulkDelete(
    ids: string[],
    userId: string,
  ): Promise<{ deleted: number }> {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const uniqueIds = [...new Set(ids)];

    const clinics = await this.clinicRepository.findMany({
      id: In(uniqueIds),
      ownerId,
    });

    if (clinics.length !== uniqueIds.length) {
      throw new NotFoundException(
        'Uma ou mais clínicas não foram encontradas.',
      );
    }

    await this.clinicRepository.getRepository().softDelete(uniqueIds);
    this.logger.log(`Clínicas soft-deleted em lote: total=${uniqueIds.length}`);

    return { deleted: uniqueIds.length };
  }
}
