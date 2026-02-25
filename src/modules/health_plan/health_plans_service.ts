import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FindManyHealthPlanDto } from './dto/find-many-health-plan.dto';
import { CreateHealthPlanDto } from './dto/create-health-plan.dto';
import { UpdateHealthPlanDto } from './dto/update-health-plan.dto';
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

  async create(data: CreateHealthPlanDto, userId: string): Promise<HealthPlan> {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    let doctorId = userId;
    if (user.role === UserRole.COLLABORATOR) {
      const teamMember =
        await this.teamMemberRepository.findByCollaboratorId(userId);
      if (!teamMember)
        throw new NotFoundException('Médico responsável não encontrado');
      doctorId = teamMember.doctor_id;
    }

    const existing = await this.healthPlanRepository.findOne({
      name: data.name,
      doctor_id: doctorId,
    });
    if (existing) {
      throw new ConflictException(
        `Já existe um convênio com o nome "${data.name}"`,
      );
    }

    return this.healthPlanRepository.create({
      ...data,
      doctor_id: doctorId,
      active: true,
    });
  }

  async update(id: string, data: UpdateHealthPlanDto): Promise<HealthPlan> {
    const healthPlan = await this.healthPlanRepository.findOne({ id });
    if (!healthPlan) throw new NotFoundException('Convênio não encontrado');
    return this.healthPlanRepository.update(id, data);
  }
}
