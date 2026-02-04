import { Injectable } from '@nestjs/common';
import { FindManyHospitalDto } from './dto/find-many-hospital.dto';
import { HospitalRepository } from 'src/database/repositories/hospital.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { FindOptionsWhere } from 'typeorm';
import { Hospital } from 'src/database/entities/hospital.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import { UserRole } from 'src/database/entities/user.entity';

@Injectable()
export class HospitalsService {
  constructor(
    private readonly hospitalRepository: HospitalRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
    private readonly userRepository: UserRepository,
  ) {}

  async findAll(query: FindManyHospitalDto, userId: number) {
    const user = await this.userRepository.findOne({ id: userId });

    // Determinar o doctor_id baseado no role do usuário
    let doctorId: number;

    if (user.role === UserRole.DOCTOR) {
      const doctorProfile =
        await this.doctorProfileRepository.findByUserId(userId);
      doctorId = doctorProfile?.id;
    } else if (user.role === UserRole.COLLABORATOR) {
      // TODO: Implementar lógica para obter o doctor do colaborador via TeamMember
      return { total: 0, records: [] };
    } else if (user.role === UserRole.ADMIN) {
      // Admin pode ver todos os hospitais
      const [total, records] = await Promise.all([
        this.hospitalRepository.total({}),
        this.hospitalRepository.findMany({}, query.skip, query.take),
      ]);
      return { total, records };
    }

    if (!doctorId) {
      return { total: 0, records: [] };
    }

    const where: FindOptionsWhere<Hospital> = { doctor_id: doctorId };

    const [total, records] = await Promise.all([
      this.hospitalRepository.total(where),
      this.hospitalRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }
}
