import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';

import { Document } from '../entities/document.entity';

@Global()
@Injectable()
export class DocumentRepository {
  constructor(
    @InjectRepository(Document)
    private readonly repository: Repository<Document>,
  ) {}

  async create(data: Partial<Document>): Promise<Document> {
    const document = this.repository.create(data);
    const saved = await this.repository.save(document);

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

  async findOneSimple(
    where: FindOptionsWhere<Document>,
  ): Promise<Document | null> {
    return await this.repository.findOne({ where });
  }
}
