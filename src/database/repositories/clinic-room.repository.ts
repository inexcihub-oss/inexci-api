import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ClinicRoom } from '../entities/clinic-room.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class ClinicRoomRepository extends BaseRepository<ClinicRoom> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(ClinicRoom));
  }

  findByClinic(ownerId: string, clinicId: string): Promise<ClinicRoom[]> {
    return this.repository.find({
      where: { ownerId, clinicId },
      order: { name: 'ASC' },
    });
  }
}
