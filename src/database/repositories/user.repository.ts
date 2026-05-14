import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, QueryDeepPartialEntity } from 'typeorm';
import { User } from '../entities/user.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class UserRepository extends BaseRepository<User> {
  constructor(
    @InjectRepository(User)
    repository: Repository<User>,
  ) {
    super(repository);
  }

  async total(where: FindOptionsWhere<User> | FindOptionsWhere<User>[]) {
    return await this.repository.count({ where });
  }

  async findOne(
    where: FindOptionsWhere<User> | FindOptionsWhere<User>[],
    selectPassword = false,
  ) {
    return await this.repository.findOne({
      where,
      relations: ['doctorProfile'],
      select: {
        id: true,
        role: true,
        status: true,
        email: true,
        name: true,
        phone: true,
        cpf: true,
        gender: true,
        birthDate: true,
        avatarUrl: true,
        emailVerified: true,
        emailVerifiedAt: true,
        password: selectPassword,
        ownerId: true,
        adminId: true,
        cep: true,
        address: true,
        addressNumber: true,
        addressComplement: true,
        city: true,
        state: true,
        privacyPolicyAcceptedAt: true,
        termsOfUseAcceptedAt: true,
        aiConsentAcceptedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOneWithProfile(
    where: FindOptionsWhere<User> | FindOptionsWhere<User>[],
  ) {
    return await this.repository.findOne({
      where,
      relations: ['doctorProfile'],
      select: {
        id: true,
        role: true,
        status: true,
        email: true,
        name: true,
        phone: true,
        cpf: true,
        gender: true,
        birthDate: true,
        avatarUrl: true,
        ownerId: true,
        adminId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findMany(
    where: FindOptionsWhere<User> | FindOptionsWhere<User>[],
    skip: number,
    take: number,
  ) {
    return await this.repository.find({
      where,
      skip,
      take,
      relations: ['doctorProfile'],
      select: {
        id: true,
        role: true,
        status: true,
        email: true,
        name: true,
        phone: true,
        cpf: true,
        gender: true,
        birthDate: true,
        avatarUrl: true,
        ownerId: true,
        adminId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findByOwnerId(
    ownerId: string,
    skip?: number,
    take?: number,
  ): Promise<User[]> {
    return await this.repository.find({
      where: { ownerId },
      skip,
      take,
      relations: ['doctorProfile'],
      order: { name: 'ASC' },
    });
  }

  async findDoctorsByOwnerId(ownerId: string): Promise<User[]> {
    return await this.repository
      .createQueryBuilder('user')
      .innerJoinAndSelect('user.doctorProfile', 'dp')
      .where('user.ownerId = :ownerId', { ownerId })
      .orderBy('user.name', 'ASC')
      .getMany();
  }

  async create(data: Partial<User>) {
    const user = this.repository.create(data);
    return await this.repository.save(user);
  }

  async update(id: string, data: Partial<User>) {
    await this.repository.update(id, data as QueryDeepPartialEntity<User>);
    return await this.findOne({ id });
  }

  findOneByPhone(phone: string): Promise<User | null> {
    return this.findOne({ phone });
  }

  async findOneWithDeleted(
    where: FindOptionsWhere<User>,
  ): Promise<User | null> {
    return await this.repository.findOne({ where, withDeleted: true });
  }
}
