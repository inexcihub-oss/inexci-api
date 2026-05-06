import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  UserDoctorAccess,
  UserDoctorAccessStatus,
} from '../entities/user-doctor-access.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class UserDoctorAccessRepository extends BaseRepository<UserDoctorAccess> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(UserDoctorAccess));
  }

  findActiveByUserId(userId: string): Promise<UserDoctorAccess[]> {
    return this.repository.find({
      where: {
        user_id: userId,
        status: UserDoctorAccessStatus.ACTIVE,
      },
      relations: ['doctor'],
    });
  }

  findActiveByDoctorUserId(doctorUserId: string): Promise<UserDoctorAccess[]> {
    return this.repository.find({
      where: {
        doctor_user_id: doctorUserId,
        status: UserDoctorAccessStatus.ACTIVE,
      },
      relations: ['user'],
    });
  }

  findByAccountId(accountId: string): Promise<UserDoctorAccess[]> {
    return this.repository
      .createQueryBuilder('uda')
      .innerJoin('user', 'u', 'u.id = uda.user_id')
      .where('u.account_id = :accountId', { accountId })
      .leftJoinAndSelect('uda.user', 'user')
      .leftJoinAndSelect('uda.doctor', 'doctor')
      .getMany();
  }

  findByUserAndDoctor(
    userId: string,
    doctorUserId: string,
  ): Promise<UserDoctorAccess | null> {
    return this.repository.findOne({
      where: { user_id: userId, doctor_user_id: doctorUserId },
    });
  }

  async upsert(data: {
    userId: string;
    doctorUserId: string;
    status: UserDoctorAccessStatus;
    createdById: string;
  }): Promise<UserDoctorAccess> {
    const existing = await this.findByUserAndDoctor(
      data.userId,
      data.doctorUserId,
    );

    if (existing) {
      existing.status = data.status;
      existing.created_by_id = data.createdById;
      return this.repository.save(existing);
    }

    const access = this.repository.create({
      user_id: data.userId,
      doctor_user_id: data.doctorUserId,
      status: data.status,
      created_by_id: data.createdById,
    });
    return this.repository.save(access);
  }

  async deactivate(
    userId: string,
    doctorUserId: string,
  ): Promise<UserDoctorAccess | null> {
    const access = await this.findByUserAndDoctor(userId, doctorUserId);
    if (!access) return null;

    access.status = UserDoctorAccessStatus.INACTIVE;
    return this.repository.save(access);
  }

  findAllByUserId(userId: string): Promise<UserDoctorAccess[]> {
    return this.repository.find({
      where: { user_id: userId },
      relations: ['doctor'],
    });
  }
}
