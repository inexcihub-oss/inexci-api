import { Injectable } from '@nestjs/common';
import { FindManyHospitalDto } from './dto/find-many-hospital.dto';
import { AuthService } from '../auth/auth.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { FindOptionsWhere } from 'typeorm';
import { UserPvs, UserStatuses } from 'src/common';
import { User } from 'src/database/entities/user.entity';

@Injectable()
export class HospitalsService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly authService: AuthService,
  ) {}

  async findAll(query: FindManyHospitalDto, userId: number) {
    const user = await this.authService.me(userId);

    // TypeORM não suporta OR diretamente em FindOptionsWhere
    // Precisamos fazer queries separadas ou usar QueryBuilder
    let where: FindOptionsWhere<User>[] = [
      {
        pv: UserPvs.hospital,
        status: UserStatuses.active,
      },
    ];

    if (user.pv === UserPvs.doctor || user.pv === UserPvs.collaborator) {
      where.push({
        pv: UserPvs.hospital,
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
