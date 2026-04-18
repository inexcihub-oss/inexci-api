import { BadRequestException, Injectable } from '@nestjs/common';
import { DocumentKeyRepository } from 'src/database/repositories/document-key.repository';
import { CreateDocumentKeyDto } from './dto/create-document-key.dto';
import { FindManyDocumentKeyDto } from './dto/find-many-dto';
import { FindOptionsWhere, In } from 'typeorm';
import { DefaultDocumentClinic } from 'src/database/entities/default-document-clinic.entity';
import { AccessControlService } from 'src/shared/services/access-control.service';

@Injectable()
export class DocumentsKeyService {
  constructor(
    private readonly documentKeyRepository: DocumentKeyRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async create(data: CreateDocumentKeyDto, userId: string) {
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (!doctorIds.length) {
      throw new BadRequestException('Doctor profile not found');
    }
    const doctorId = doctorIds[0];

    const keyFound = await this.documentKeyRepository.findOne({
      key: data.key,
      doctor_id: doctorId,
    });

    if (!keyFound) {
      return await this.documentKeyRepository.create({
        key: data.key,
        name: data.name,
        doctor_id: doctorId,
        created_by: userId,
      });
    }
    return;
  }

  async findAll(query: FindManyDocumentKeyDto, userId: string) {
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (!doctorIds.length) {
      return { total: 0, records: [] };
    }

    const where: FindOptionsWhere<DefaultDocumentClinic> = {
      doctor_id: In(doctorIds),
    };

    const [total, records] = await Promise.all([
      this.documentKeyRepository.total(where),
      this.documentKeyRepository.findMany(where),
    ]);

    return { total, records };
  }
}
