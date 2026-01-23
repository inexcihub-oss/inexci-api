import { Injectable } from '@nestjs/common';
import { FindManyPatientDto } from './dto/find-many-patient.dto';
import { UserRepository } from 'src/database/repositories/user.repository';
import { AuthService } from '../auth/auth.service';
import { FindOptionsWhere } from 'typeorm';
import { UserPvs, UserStatuses } from 'src/common';
import { User } from 'src/database/entities/user.entity';

@Injectable()
export class PatientsService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly authService: AuthService,
  ) {}

  async findAll(query: FindManyPatientDto, userId: number) {
    const user = await this.authService.me(userId);

    // TypeORM não suporta OR diretamente em FindOptionsWhere
    // Precisamos usar array de FindOptionsWhere
    let where: FindOptionsWhere<User>[] = [
      {
        profile: UserPvs.patient,
        status: UserStatuses.active,
      },
    ];

    if (
      user.profile === UserPvs.doctor ||
      user.profile === UserPvs.collaborator
    ) {
      where.push({
        profile: UserPvs.patient,
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
