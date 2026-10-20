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
        userId,
        status: UserDoctorAccessStatus.ACTIVE,
      },
      relations: ['doctor'],
    });
  }

  findActiveByDoctorUserId(doctorUserId: string): Promise<UserDoctorAccess[]> {
    return this.repository.find({
      where: {
        doctorUserId,
        status: UserDoctorAccessStatus.ACTIVE,
      },
      relations: ['user'],
    });
  }

  findByUserAndDoctor(
    userId: string,
    doctorUserId: string,
  ): Promise<UserDoctorAccess | null> {
    return this.repository.findOne({
      where: { userId, doctorUserId },
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
      existing.createdById = data.createdById;
      return this.repository.save(existing);
    }

    const access = this.repository.create({
      userId: data.userId,
      doctorUserId: data.doctorUserId,
      status: data.status,
      createdById: data.createdById,
    });
    return this.repository.save(access);
  }

  findAllByUserId(userId: string): Promise<UserDoctorAccess[]> {
    return this.repository.find({
      where: { userId },
      relations: ['doctor'],
    });
  }

  replaceDoctorsForUser(
    userId: string,
    doctorUserIds: string[],
    createdById: string,
  ): Promise<UserDoctorAccess[]> {
    return this.repository.manager.transaction(async (em) => {
      const repo = em.getRepository(UserDoctorAccess);
      const existentes = await repo.find({ where: { userId } });
      const porMedico = new Map(existentes.map((a) => [a.doctorUserId, a]));
      const desejados = new Set(doctorUserIds);

      for (const acesso of existentes) {
        if (
          !desejados.has(acesso.doctorUserId) &&
          acesso.status !== UserDoctorAccessStatus.INACTIVE
        ) {
          acesso.status = UserDoctorAccessStatus.INACTIVE;
          await repo.save(acesso);
        }
      }

      for (const doctorUserId of desejados) {
        const atual = porMedico.get(doctorUserId);
        await repo.save(
          atual
            ? Object.assign(atual, {
                status: UserDoctorAccessStatus.ACTIVE,
                createdById,
              })
            : repo.create({
                userId,
                doctorUserId,
                status: UserDoctorAccessStatus.ACTIVE,
                createdById,
              }),
        );
      }

      return repo.find({ where: { userId }, relations: ['doctor'] });
    });
  }
}
