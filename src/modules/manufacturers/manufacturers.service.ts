import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { FindOptionsWhere } from 'typeorm';
import { Manufacturer } from 'src/database/entities/manufacturer.entity';
import { ManufacturerRepository } from 'src/database/repositories/manufacturer.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import {
  bulkDeleteOwned,
  createOrRestoreByName,
  findOwnedOrFail,
  resolveCatalogOwnerId,
} from 'src/shared/catalog/owned-catalog.helpers';
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
    const where: FindOptionsWhere<Manufacturer> = {
      ownerId,
      isGeneric: false,
    };

    const [total, records] = await Promise.all([
      this.manufacturerRepository.total(where),
      this.manufacturerRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }

  findById(id: string, userId: string): Promise<Manufacturer> {
    return this.findOwned(id, userId);
  }

  private assertNaoEGenerico(registro: { isGeneric?: boolean }): void {
    if (registro.isGeneric) {
      throw new ForbiddenException(
        'O fabricante "Outro" é da plataforma e não pode ser alterado nem excluído.',
      );
    }
  }

  async update(
    id: string,
    data: UpdateManufacturerDto,
    userId: string,
  ): Promise<Manufacturer> {
    const registro = await this.findOwned(id, userId);
    this.assertNaoEGenerico(registro);
    return (await this.manufacturerRepository.update(id, data))!;
  }

  async create(
    data: CreateManufacturerDto,
    userId: string,
  ): Promise<Manufacturer> {
    const ownerId = await resolveCatalogOwnerId(
      this.accessControlService,
      userId,
    );

    return createOrRestoreByName({
      repository: this.manufacturerRepository,
      ownerId,
      data,
      conflictMessage: (nome) =>
        `Já existe um fabricante com o nome "${nome}".`,
      logger: this.logger,
    });
  }

  async delete(id: string, userId: string): Promise<void> {
    const registro = await this.findOwned(id, userId);
    this.assertNaoEGenerico(registro);
    await this.manufacturerRepository.softDelete(id);
    this.logger.log(`Fabricante soft-deleted: id=${id}`);
  }

  async bulkDelete(
    ids: string[],
    userId: string,
  ): Promise<{ deleted: number }> {
    const ownerId = await resolveCatalogOwnerId(
      this.accessControlService,
      userId,
    );
    const result = await bulkDeleteOwned({
      repository: this.manufacturerRepository,
      ids,
      ownerId,
      notFoundMessage: 'Um ou mais fabricantes não foram encontrados.',
      guard: (registro) => this.assertNaoEGenerico(registro),
    });
    this.logger.log(
      `Fabricantes soft-deleted em lote: total=${result.deleted}`,
    );
    return result;
  }

  private findOwned(id: string, userId: string): Promise<Manufacturer> {
    return findOwnedOrFail(
      this.manufacturerRepository,
      this.accessControlService,
      id,
      userId,
      'Fabricante não encontrado',
    );
  }
}
