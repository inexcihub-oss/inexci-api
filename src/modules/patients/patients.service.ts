import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FindManyPatientDto } from './dto/find-many-patient.dto';
import { CreatePatientDto } from './dto/create-patient.dto';
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

  async findAll(query: FindManyPatientDto, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });

    // Determinar o doctor_id baseado no role do usuário
    let doctorId: string;

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

  async create(data: CreatePatientDto, userId: string): Promise<Patient> {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    let doctorProfileId: string;
    if (user.role === UserRole.DOCTOR) {
      const profile = await this.doctorProfileRepository.findByUserId(userId);
      if (!profile)
        throw new BadRequestException(
          'Perfil de médico não encontrado. Configure seu perfil antes de criar pacientes.',
        );
      doctorProfileId = profile.id;
    } else {
      throw new BadRequestException('Apenas médicos podem criar pacientes.');
    }

    return this.patientRepository.create({
      doctor_id: doctorProfileId,
      name: data.name,
      phone: data.phone,
      cpf: data.cpf,
      gender: data.gender,
      birth_date: new Date(data.birth_date),
      health_plan_id: data.health_plan_id,
      health_plan_number: data.health_plan_number,
      health_plan_type: data.health_plan_type,
      email: data.email,
      zip_code: data.zip_code,
      address: data.address,
      address_number: data.address_number,
      address_complement: data.address_complement,
      neighborhood: data.neighborhood,
      city: data.city,
      state: data.state,
      medical_notes: data.medical_notes,
      active: true,
    });
  }
}
