import { Injectable } from '@nestjs/common';
import { FindManyHospitalDto } from './dto/find-many-hospital.dto';
import { HospitalRepository } from 'src/database/repositories/hospital.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { FindOptionsWhere } from 'typeorm';
import { Hospital } from 'src/database/entities/hospital.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import { UserRole } from 'src/database/entities/user.entity';
import { TeamMemberRepository } from 'src/database/repositories/team-member.repository';

@Injectable()
export class HospitalsService {
  constructor(
    private readonly hospitalRepository: HospitalRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
    private readonly userRepository: UserRepository,
    private readonly teamMemberRepository: TeamMemberRepository,
  ) {}

  async findAll(query: FindManyHospitalDto, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });

    // Determinar o doctor_id baseado no role do usuário
    let doctorId: string;

    if (user.role === UserRole.DOCTOR) {
      doctorId = userId;
    } else if (user.role === UserRole.COLLABORATOR) {
      // Buscar o médico do colaborador via TeamMember
      const teamMember =
        await this.teamMemberRepository.findByCollaboratorId(userId);
      if (!teamMember) {
        return { total: 0, records: [] };
      }
      doctorId = teamMember.doctor_id;
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

    // Buscar apenas hospitais do médico
    const where: FindOptionsWhere<Hospital> = { doctor_id: doctorId };

    const [total, records] = await Promise.all([
      this.hospitalRepository.total(where),
      this.hospitalRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }
}
