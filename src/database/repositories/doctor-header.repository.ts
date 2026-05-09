import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DoctorHeader } from '../entities/doctor-header.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class DoctorHeaderRepository extends BaseRepository<DoctorHeader> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(DoctorHeader));
  }

  findByDoctorProfileId(doctorProfileId: string): Promise<DoctorHeader | null> {
    return this.repository.findOne({
      where: { doctorProfileId },
    });
  }

  async upsert(
    doctorProfileId: string,
    data: Partial<
      Pick<DoctorHeader, 'logoUrl' | 'logoPosition' | 'contentHtml'>
    >,
  ): Promise<DoctorHeader> {
    const existing = await this.findByDoctorProfileId(doctorProfileId);
    if (existing) {
      await this.repository.update(existing.id, data);
      return (await this.findByDoctorProfileId(doctorProfileId))!;
    }
    const entity = this.repository.create({
      doctorProfileId,
      ...data,
    });
    return this.repository.save(entity);
  }

  async removeByDoctorProfileId(doctorProfileId: string): Promise<void> {
    await this.repository.delete({ doctorProfileId });
  }
}
