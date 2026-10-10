import { ConflictException, Injectable } from '@nestjs/common';
import { FindManyProcedureDto } from './dto/find-many-procedure.dto';
import { CreateProcedureDto } from './dto/create-procedure.dto';
import { UpdateProcedureDto } from './dto/update-procedure.dto';
import { ProcedureRepository } from 'src/database/repositories/procedure.repository';
import { Procedure } from 'src/database/entities/procedure.entity';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { violacaoDeUnicidade } from 'src/database/repositories/unique-violation.util';
import { findOwnedOrFail } from 'src/shared/catalog/owned-catalog.helpers';

@Injectable()
export class ProceduresService {
  constructor(
    private readonly procedureRepository: ProcedureRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async findAll(query: FindManyProcedureDto, userId: string) {
    const ownerId = await this.accessControlService.getOwnerId(userId);

    const [records, total] = await Promise.all([
      this.procedureRepository.findMany(
        { ownerId },
        query.skip ?? 0,
        query.take ?? 20,
      ),
      this.procedureRepository.total({ ownerId }),
    ]);

    return { total, records };
  }

  findOne(id: string, userId: string): Promise<Procedure> {
    return findOwnedOrFail(
      this.procedureRepository,
      this.accessControlService,
      id,
      userId,
      'Procedimento não encontrado',
    );
  }

  async create(data: CreateProcedureDto, userId: string): Promise<Procedure> {
    const ownerId = await this.accessControlService.getOwnerId(userId);

    const normalizedName = data.name.trim();
    const existing = await this.procedureRepository.findActiveByOwnerAndName(
      ownerId,
      normalizedName,
    );
    if (existing) {
      throw new ConflictException(
        `Já existe um procedimento com o nome "${normalizedName}"`,
      );
    }

    try {
      return await this.procedureRepository.create({
        ...data,
        name: normalizedName,
        ownerId,
      });
    } catch (error: unknown) {
      this.throwIfUniqueViolation(error, normalizedName);
      throw error;
    }
  }

  async update(
    id: string,
    data: UpdateProcedureDto,
    userId: string,
  ): Promise<Procedure> {
    const procedure = await this.findOne(id, userId);

    if (typeof data.name === 'string') {
      const normalizedName = data.name.trim();
      if (normalizedName) {
        const duplicate =
          await this.procedureRepository.findActiveByOwnerAndName(
            procedure.ownerId,
            normalizedName,
            id,
          );

        if (duplicate) {
          throw new ConflictException(
            `Já existe um procedimento com o nome "${normalizedName}"`,
          );
        }

        data = { ...data, name: normalizedName };
      }
    }

    try {
      return (await this.procedureRepository.update(id, data))!;
    } catch (error: unknown) {
      this.throwIfUniqueViolation(error, data.name);
      throw error;
    }
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.findOne(id, userId);
    await this.procedureRepository.delete(id);
  }

  private throwIfUniqueViolation(error: unknown, name?: string): void {
    if (violacaoDeUnicidade(error)) {
      throw new ConflictException(
        `Já existe um procedimento com o nome "${name ?? ''}"`,
      );
    }
  }
}
