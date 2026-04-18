import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { DefaultDocumentClinic } from '../entities/default-document-clinic.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class DocumentKeyRepository extends BaseRepository<DefaultDocumentClinic> {
  constructor(
    @InjectRepository(DefaultDocumentClinic)
    repository: Repository<DefaultDocumentClinic>,
  ) {
    super(repository);
  }

  async create(
    data: Partial<DefaultDocumentClinic>,
  ): Promise<DefaultDocumentClinic> {
    const documentKey = this.repository.create(data);
    const saved = await this.repository.save(documentKey);

    return await this.repository.findOne({
      where: { id: saved.id },
      relations: ['creator'],
      select: {
        id: true,
        key: true,
        name: true,
        created_by: true,
        creator: {
          id: true,
          name: true,
        },
      },
    });
  }

  async findDoctorId(
    where: FindOptionsWhere<DefaultDocumentClinic>,
  ): Promise<{ doctor_id: string } | null> {
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
}
