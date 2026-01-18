import { BadRequestException, Injectable } from '@nestjs/common';
import { DocumentKeyRepository } from 'src/database/repositories/document-key.repository';
import { CreateDocumentKeyDto } from './dto/create-document-key.dto';
import { UserRepository } from 'src/database/repositories/user.repository';
import { FindManyDocumentKeyDto } from './dto/find-many-dto';
import { FindOptionsWhere } from 'typeorm';
import { DefaultDocumentClinic } from 'src/database/entities/default-document-clinic.entity';

@Injectable()
export class DocumentsKeyService {
  constructor(
    private readonly documentKeyRepository: DocumentKeyRepository,
    private readonly userRepository: UserRepository,
  ) {}

  async create(data: CreateDocumentKeyDto, userId: number) {
    const user = await this.userRepository.findOne({ id: userId });

    const keyFound = await this.documentKeyRepository.findOne({
      key: data.key,
      clinic_id: user.clinic_id,
    });

    if (!keyFound) {
      return await this.documentKeyRepository.create({
        key: data.key,
        name: data.name,
        clinic_id: user.clinic_id,
        created_by: userId,
      });
    }
    return;
  }

  async findAll(query: FindManyDocumentKeyDto, userId: number) {
    const user = await this.userRepository.findOne({ id: userId });

    const where: FindOptionsWhere<DefaultDocumentClinic> = {
      clinic_id: user.clinic_id,
    };

    const [total, records] = await Promise.all([
      this.documentKeyRepository.total(where),
      this.documentKeyRepository.findMany(where),
    ]);

    return { total, records };
  }
}
