import { Injectable } from '@nestjs/common';
import { FindManyHealthPlanDto } from './dto/find-many-health-plan.dto';
import { FindOptionsWhere } from 'typeorm';
import { HealthPlanRepository } from 'src/database/repositories/health-plan.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { HealthPlan } from 'src/database/entities/health-plan.entity';
import { UserRole } from 'src/database/entities/user.entity';

@Injectable()
export class HealthPlansService {
  constructor(
    private readonly healthPlanRepository: HealthPlanRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
    private readonly userRepository: UserRepository,
  ) {}

  async findAll(query: FindManyHealthPlanDto, userId: number) {
    const user = await this.userRepository.findOne({ id: userId });

    if (user.role === UserRole.ADMIN) {
      // Admin pode ver todos os convênios
      const [total, records] = await Promise.all([
        this.healthPlanRepository.total({}),
        this.healthPlanRepository.findMany({}, query.skip, query.take),
      ]);
      return { total, records };
    }

    // Determinar o doctor_id baseado no role do usuário
    let doctorId: number;

    if (user.role === UserRole.DOCTOR) {
      const doctorProfile =
        await this.doctorProfileRepository.findByUserId(userId);
      doctorId = doctorProfile?.id;
    } else if (user.role === UserRole.COLLABORATOR) {
      // TODO: Implementar lógica para obter o doctor do colaborador via TeamMember
      return { total: 0, records: [] };
    }

    if (!doctorId) {
      return { total: 0, records: [] };
    }

    // Buscar convênios globais + específicos do médico
    const where: FindOptionsWhere<HealthPlan>[] = [
      { is_global: true },
      { doctor_id: doctorId },
    ];

    const [total, records] = await Promise.all([
      this.healthPlanRepository.total(where),
      this.healthPlanRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }
}
