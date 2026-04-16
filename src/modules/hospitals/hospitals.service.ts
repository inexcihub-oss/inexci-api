import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FindManyHospitalDto } from './dto/find-many-hospital.dto';
import { CreateHospitalDto } from './dto/create-hospital.dto';
import { UpdateHospitalDto } from './dto/update-hospital.dto';
import { HospitalRepository } from 'src/database/repositories/hospital.repository';
import { FindOptionsWhere, In } from 'typeorm';
import { Hospital } from 'src/database/entities/hospital.entity';
import { AccessControlService } from 'src/shared/services/access-control.service';

@Injectable()
export class HospitalsService {
  constructor(
    private readonly hospitalRepository: HospitalRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async findAll(query: FindManyHospitalDto, userId: string) {
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (doctorIds.length === 0) {
      return { total: 0, records: [] };
    }

    const where: FindOptionsWhere<Hospital> = { doctor_id: In(doctorIds) };

    const [total, records] = await Promise.all([
      this.hospitalRepository.total(where),
      this.hospitalRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }

  async create(data: CreateHospitalDto, userId: string): Promise<Hospital> {
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (doctorIds.length === 0) {
      throw new NotFoundException('Nenhum médico acessível');
    }
    const doctorId = doctorIds.includes(userId) ? userId : doctorIds[0];

    const existing = await this.hospitalRepository.findOne({
      name: data.name,
      doctor_id: doctorId,
    });
    if (existing) {
      throw new ConflictException(
        `Já existe um hospital com o nome "${data.name}"`,
      );
    }

    return this.hospitalRepository.create({
      ...data,
      doctor_id: doctorId,
      active: true,
    });
  }

  async update(id: string, data: UpdateHospitalDto): Promise<Hospital> {
    const hospital = await this.hospitalRepository.findOne({ id });
    if (!hospital) throw new NotFoundException('Hospital não encontrado');
    return this.hospitalRepository.update(id, data);
  }
}
