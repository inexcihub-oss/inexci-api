import { Injectable } from '@nestjs/common';
import { FindManyHealthPlanDto } from './dto/find-many-health-plan.dto';
import { AuthService } from '../auth/auth.service';
import { FindOptionsWhere } from 'typeorm';
import { UserPvs, UserStatuses } from 'src/common';
import { UserRepository } from 'src/database/repositories/user.repository';
import { User } from 'src/database/entities/user.entity';

@Injectable()
export class HealthPlansService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly authService: AuthService,
  ) {}

  async findAll(query: FindManyHealthPlanDto, userId: number) {
    const user = await this.authService.me(userId);

    // TypeORM usa array de FindOptionsWhere para OR
    let where: FindOptionsWhere<User>[] = [
      {
        pv: UserPvs.health_plan,
        status: UserStatuses.active,
      },
    ];

    if (user.pv === UserPvs.doctor || user.pv === UserPvs.collaborator) {
      where.push({
        pv: UserPvs.health_plan,
        status: UserStatuses.incomplete,
        clinic_id: user.clinic_id,
      });
    }

    const [total, records] = await Promise.all([
      this.userRepository.total(where),
      this.userRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }
}
