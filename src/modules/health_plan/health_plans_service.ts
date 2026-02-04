import { Injectable } from '@nestjs/common';
import { FindManyHealthPlanDto } from './dto/find-many-health-plan.dto';
import { FindOptionsWhere } from 'typeorm';
import { HealthPlanRepository } from 'src/database/repositories/health-plan.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { HealthPlan } from 'src/database/entities/health-plan.entity';
import { UserRole } from 'src/database/entities/user.entity';
import { TeamMemberRepository } from 'src/database/repositories/team-member.repository';

@Injectable()
export class HealthPlansService {
  constructor(
    private readonly healthPlanRepository: HealthPlanRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
    private readonly userRepository: UserRepository,
    private readonly teamMemberRepository: TeamMemberRepository,
  ) {}

  async findAll(query: FindManyHealthPlanDto, userId: string) {
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
    }

    if (!doctorId) {
      return { total: 0, records: [] };
    }

    // Buscar apenas convênios do médico
    const where: FindOptionsWhere<HealthPlan> = { doctor_id: doctorId };

    const [total, records] = await Promise.all([
      this.healthPlanRepository.total(where),
      this.healthPlanRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }
}
