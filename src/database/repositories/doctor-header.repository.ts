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
      where: { doctor_profile_id: doctorProfileId },
    });
  }

  async upsert(
    doctorProfileId: string,
    data: Partial<Pick<DoctorHeader, 'logo_url' | 'logo_position' | 'content_html'>>,
  ): Promise<DoctorHeader> {
    const existing = await this.findByDoctorProfileId(doctorProfileId);
    if (existing) {
      await this.repository.update(existing.id, data as any);
      return (await this.findByDoctorProfileId(doctorProfileId))!;
    }
    const entity = this.repository.create({
      doctor_profile_id: doctorProfileId,
      ...data,
    });
    return this.repository.save(entity);
  }

  async removeByDoctorProfileId(doctorProfileId: string): Promise<void> {
    await this.repository.delete({ doctor_profile_id: doctorProfileId });
  }
}
