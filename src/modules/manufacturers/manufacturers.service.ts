import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { FindOptionsWhere, In } from 'typeorm';
import { Manufacturer } from 'src/database/entities/manufacturer.entity';
import { ManufacturerRepository } from 'src/database/repositories/manufacturer.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { FindManyManufacturerDto } from './dto/find-many-manufacturer.dto';
import { UpdateManufacturerDto } from './dto/update-manufacturer.dto';
import { CreateManufacturerDto } from './dto/create-manufacturer.dto';

@Injectable()
export class ManufacturersService {
  private readonly logger = new Logger(ManufacturersService.name);

  constructor(
    private readonly manufacturerRepository: ManufacturerRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async findAll(query: FindManyManufacturerDto, userId: string) {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const where: FindOptionsWhere<Manufacturer> = { ownerId };

    const [total, records] = await Promise.all([
      this.manufacturerRepository.total(where),
      this.manufacturerRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }

  async findById(id: string, userId: string): Promise<Manufacturer> {
    const manufacturer = await this.manufacturerRepository.findOne({ id });
    if (!manufacturer) throw new NotFoundException('Fabricante não encontrado');

    await this.accessControlService.assertSameOwner(
      userId,
      manufacturer.ownerId,
    );
    return manufacturer;
  }

  async update(
    id: string,
    data: UpdateManufacturerDto,
    userId: string,
  ): Promise<Manufacturer> {
    const manufacturer = await this.manufacturerRepository.findOne({ id });
    if (!manufacturer) throw new NotFoundException('Fabricante não encontrado');

    await this.accessControlService.assertSameOwner(
      userId,
      manufacturer.ownerId,
    );
    return (await this.manufacturerRepository.update(id, data))!;
  }

  async create(
    data: CreateManufacturerDto,
    userId: string,
  ): Promise<Manufacturer> {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    if (!ownerId) {
      throw new ForbiddenException('Usuário sem clínica vinculada.');
    }

    const existingIncludingDeleted =
      await this.manufacturerRepository.findByNameIncludingDeleted(
        ownerId,
        data.name,
      );

    if (existingIncludingDeleted && !existingIncludingDeleted.deletedAt) {
      throw new ConflictException(
        `Já existe um fabricante com o nome "${data.name.trim()}".`,
      );
    }

    if (existingIncludingDeleted?.deletedAt) {
      await this.manufacturerRepository.restore(existingIncludingDeleted.id);
      const restored = await this.manufacturerRepository.update(
        existingIncludingDeleted.id,
        data,
      );
      this.logger.log(
        `Fabricante restaurado após soft delete: id=${existingIncludingDeleted.id}`,
      );
      return restored!;
    }

    return this.manufacturerRepository.create({
      ...data,
      ownerId,
    });
  }

  async delete(id: string, userId: string): Promise<void> {
    const manufacturer = await this.manufacturerRepository.findOne({ id });
    if (!manufacturer) throw new NotFoundException('Fabricante não encontrado');

    await this.accessControlService.assertSameOwner(
      userId,
      manufacturer.ownerId,
    );
    await this.manufacturerRepository.softDelete(id);
    this.logger.log(`Fabricante soft-deleted: id=${id}`);
  }

  async bulkDelete(
    ids: string[],
    userId: string,
  ): Promise<{ deleted: number }> {
    const ownerId = await this.accessControlService.getOwnerId(userId);

    if (!ownerId) {
      throw new ForbiddenException('Usuário sem clínica vinculada.');
    }

    const uniqueIds = [...new Set(ids)];
    const manufacturers = await this.manufacturerRepository.findMany({
      id: In(uniqueIds),
      ownerId,
    });

    if (manufacturers.length !== uniqueIds.length) {
      throw new NotFoundException(
        'Um ou mais fabricantes não foram encontrados.',
      );
    }

    await this.manufacturerRepository.bulkSoftDelete(uniqueIds);
    this.logger.log(
      `Fabricantes soft-deleted em lote: total=${uniqueIds.length}`,
    );

    return { deleted: uniqueIds.length };
  }
}
