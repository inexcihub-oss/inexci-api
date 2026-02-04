import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';

import { DefaultDocumentClinic } from '../entities/default-document-clinic.entity';

@Global()
@Injectable()
export class DocumentKeyRepository {
  constructor(
    @InjectRepository(DefaultDocumentClinic)
    private readonly repository: Repository<DefaultDocumentClinic>,
  ) {}

  async create(
    data: Partial<DefaultDocumentClinic>,
  ): Promise<DefaultDocumentClinic> {
    const documentKey = this.repository.create(data);
    const saved = await this.repository.save(documentKey);

    // Carregar com relacionamento creator
    return await this.repository.findOne({
      where: { id: saved.id },
      relations: ['creator'],
      select: {
        id: true,
        creator: {
          id: true,
          name: true,
        },
      },
    });
  }

  async findOne(
    where: FindOptionsWhere<DefaultDocumentClinic>,
  ): Promise<{ doctor_id: number } | null> {
    const result = await this.repository.findOne({
      where,
      select: ['doctor_id'],
    });
    return result ? { doctor_id: result.doctor_id } : null;
  }

  async findMany(
    where: FindOptionsWhere<DefaultDocumentClinic>,
  ): Promise<DefaultDocumentClinic[]> {
    return await this.repository.find({ where });
  }

  async total(where: FindOptionsWhere<DefaultDocumentClinic>): Promise<number> {
    return await this.repository.count({ where });
  }
}
