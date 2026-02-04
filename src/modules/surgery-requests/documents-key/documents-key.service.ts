import { BadRequestException, Injectable } from '@nestjs/common';
import { DocumentKeyRepository } from 'src/database/repositories/document-key.repository';
import { CreateDocumentKeyDto } from './dto/create-document-key.dto';
import { UserRepository } from 'src/database/repositories/user.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { FindManyDocumentKeyDto } from './dto/find-many-dto';
import { FindOptionsWhere } from 'typeorm';
import { DefaultDocumentClinic } from 'src/database/entities/default-document-clinic.entity';
import { UserRole } from 'src/database/entities/user.entity';

@Injectable()
export class DocumentsKeyService {
  constructor(
    private readonly documentKeyRepository: DocumentKeyRepository,
    private readonly userRepository: UserRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
  ) {}

  private async getDoctorId(userId: string): Promise<string | null> {
    const user = await this.userRepository.findOne({ id: userId });

    if (user.role === UserRole.DOCTOR) {
      const doctorProfile =
        await this.doctorProfileRepository.findByUserId(userId);
      return doctorProfile?.id || null;
    }

    // TODO: Para colaboradores, obter via TeamMember
    return null;
  }

  async create(data: CreateDocumentKeyDto, userId: string) {
    const doctorId = await this.getDoctorId(userId);

    if (!doctorId) {
      throw new BadRequestException('Doctor profile not found');
    }

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
    const doctorId = await this.getDoctorId(userId);

    if (!doctorId) {
      return { total: 0, records: [] };
    }

    const where: FindOptionsWhere<DefaultDocumentClinic> = {
      doctor_id: doctorId,
    };

    const [total, records] = await Promise.all([
      this.documentKeyRepository.total(where),
      this.documentKeyRepository.findMany(where),
    ]);

    return { total, records };
  }
}
