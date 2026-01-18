import { Injectable } from '@nestjs/common';
import { FindManyPendenciesDto } from './dto/find-many-pendencies.dto';
import { PendencyRepository } from 'src/database/repositories/pendency.repository';
import { FindOptionsWhere } from 'typeorm';
import { UpdatePendencyDto } from './dto/update-pendency.dto';
import { Pendency } from 'src/database/entities/pendency.entity';

@Injectable()
export class PendenciesService {
  constructor(private readonly pendencyRepository: PendencyRepository) {}

  async close(data: UpdatePendencyDto | FindOptionsWhere<Pendency>) {
    // Se for UpdatePendencyDto, criar where
    let where: FindOptionsWhere<Pendency>;
    if ('surgery_request_id' in data && 'key' in data) {
      where = {
        surgery_request_id: data.surgery_request_id,
        key: data.key,
      };
    } else {
      where = data as FindOptionsWhere<Pendency>;
    }

    return await this.pendencyRepository.updateMany(where, {
      concluded_at: new Date(),
    });
  }

  async findAll(query: FindManyPendenciesDto, userId: number) {
    const where: FindOptionsWhere<Pendency> = {
      surgery_request_id: query.surgery_request_id,
      concluded_at: null,
    };

    const [total, records] = await Promise.all([
      this.pendencyRepository.total(where),
      this.pendencyRepository.findMany(where),
    ]);

    return { total, records };
  }
}
