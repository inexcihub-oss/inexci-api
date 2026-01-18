import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';

import { Clinic } from '../entities/clinic.entity';

@Global()
@Injectable()
export class HealthPlanRepository {
  constructor(
    @InjectRepository(Clinic)
    private readonly repository: Repository<Clinic>,
  ) {}

  // TODO: Implementar métodos conforme necessário
  // Este repository estava vazio no código original
}
