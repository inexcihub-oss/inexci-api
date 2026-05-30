import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FindManyProcedureDto } from './dto/find-many-procedure.dto';
import { CreateProcedureDto } from './dto/create-procedure.dto';
import { UpdateProcedureDto } from './dto/update-procedure.dto';
import { ProcedureRepository } from 'src/database/repositories/procedure.repository';
import { Procedure } from 'src/database/entities/procedure.entity';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { QueryFailedError } from 'typeorm';

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

  async findOne(id: string, userId: string): Promise<Procedure> {
    const procedure = await this.procedureRepository.findOne({ id });
    if (!procedure) {
      throw new NotFoundException('Procedimento não encontrado');
    }
    await this.accessControlService.assertSameOwner(userId, procedure.ownerId);
    return procedure;
  }

  async create(data: CreateProcedureDto, userId: string): Promise<Procedure> {
    const ownerId = await this.accessControlService.getOwnerId(userId);

    const normalizedName = data.name.trim();
    const existing = await this.findActiveByOwnerAndName(
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
    const procedure = await this.procedureRepository.findOne({ id });
    if (!procedure) {
      throw new NotFoundException('Procedimento não encontrado');
    }
    await this.accessControlService.assertSameOwner(userId, procedure.ownerId);

    if (typeof data.name === 'string') {
      const normalizedName = data.name.trim();
      if (normalizedName) {
        const duplicate = await this.procedureRepository
          .getRepository()
          .createQueryBuilder('procedure')
          .where('procedure.owner_id = :ownerId', {
            ownerId: procedure.ownerId,
          })
          .andWhere('LOWER(procedure.name) = LOWER(:name)', {
            name: normalizedName,
          })
          .andWhere('procedure.deleted_at IS NULL')
          .andWhere('procedure.id <> :id', { id })
          .getOne();

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
    const procedure = await this.procedureRepository.findOne({ id });
    if (!procedure) {
      throw new NotFoundException('Procedimento não encontrado');
    }
    await this.accessControlService.assertSameOwner(userId, procedure.ownerId);
    await this.procedureRepository.delete(id);
  }

  private async findActiveByOwnerAndName(
    ownerId: string,
    name: string,
  ): Promise<Procedure | null> {
    return this.procedureRepository
      .getRepository()
      .createQueryBuilder('procedure')
      .where('procedure.owner_id = :ownerId', { ownerId })
      .andWhere('LOWER(procedure.name) = LOWER(:name)', { name })
      .andWhere('procedure.deleted_at IS NULL')
      .getOne();
  }

  private throwIfUniqueViolation(error: unknown, name?: string): void {
    if (
      error instanceof QueryFailedError &&
      (error as any).driverError?.code === '23505'
    ) {
      throw new ConflictException(
        `Já existe um procedimento com o nome "${name ?? ''}"`,
      );
    }
  }
}
