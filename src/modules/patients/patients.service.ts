import { Injectable } from '@nestjs/common';
import { FindManyPatientDto } from './dto/find-many-patient.dto';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { FindOptionsWhere } from 'typeorm';
import { Patient } from 'src/database/entities/patient.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import { UserRole } from 'src/database/entities/user.entity';

@Injectable()
export class PatientsService {
  constructor(
    private readonly patientRepository: PatientRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
    private readonly userRepository: UserRepository,
  ) {}

  async findAll(query: FindManyPatientDto, userId: number) {
    const user = await this.userRepository.findOne({ id: userId });

    // Determinar o doctor_id baseado no role do usuário
    let doctorId: number;

    if (user.role === UserRole.DOCTOR) {
      const doctorProfile =
        await this.doctorProfileRepository.findByUserId(userId);
      doctorId = doctorProfile?.id;
    } else if (user.role === UserRole.COLLABORATOR) {
      // TODO: Implementar lógica para obter o doctor do colaborador via TeamMember
      // Por enquanto, retorna vazio
      return { total: 0, records: [] };
    } else if (user.role === UserRole.ADMIN) {
      // Admin pode ver todos os pacientes - sem filtro por doctor_id
      const [total, records] = await Promise.all([
        this.patientRepository.total({}),
        this.patientRepository.findMany({}, query.skip, query.take),
      ]);
      return { total, records };
    }

    if (!doctorId) {
      return { total: 0, records: [] };
    }

    const where: FindOptionsWhere<Patient> = { doctor_id: doctorId };

    const [total, records] = await Promise.all([
      this.patientRepository.total(where),
      this.patientRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }
}
