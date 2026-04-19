import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
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
      relations: ['doctor_profile'],
      select: {
        id: true,
        role: true,
        status: true,
        email: true,
        name: true,
        phone: true,
        cpf: true,
        gender: true,
        birth_date: true,
        avatar_url: true,
        password: selectPassword,
        account_id: true,
        subscription_plan_id: true,
        admin_id: true,
        cep: true,
        address: true,
        address_number: true,
        address_complement: true,
        city: true,
        state: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  async findOneWithProfile(
    where: FindOptionsWhere<User> | FindOptionsWhere<User>[],
  ) {
    return await this.repository.findOne({
      where,
      relations: ['doctor_profile', 'subscription_plan'],
      select: {
        id: true,
        role: true,
        status: true,
        email: true,
        name: true,
        phone: true,
        cpf: true,
        gender: true,
        birth_date: true,
        avatar_url: true,
        account_id: true,
        subscription_plan_id: true,
        admin_id: true,
        created_at: true,
        updated_at: true,
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
      relations: ['doctor_profile'],
      select: {
        id: true,
        role: true,
        status: true,
        email: true,
        name: true,
        phone: true,
        cpf: true,
        gender: true,
        birth_date: true,
        avatar_url: true,
        account_id: true,
        subscription_plan_id: true,
        admin_id: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  async findByAccountId(
    accountId: string,
    skip?: number,
    take?: number,
  ): Promise<User[]> {
    return await this.repository.find({
      where: { account_id: accountId },
      skip,
      take,
      relations: ['doctor_profile'],
      order: { name: 'ASC' },
    });
  }

  async findDoctorsByAccountId(accountId: string): Promise<User[]> {
    return await this.repository
      .createQueryBuilder('user')
      .innerJoinAndSelect('user.doctor_profile', 'dp')
      .where('user.account_id = :accountId', { accountId })
      .orderBy('user.name', 'ASC')
      .getMany();
  }

  async countDoctorsByAccountId(accountId: string): Promise<number> {
    return await this.repository
      .createQueryBuilder('user')
      .innerJoin('doctor_profile', 'dp', 'dp.user_id = user.id')
      .where('user.account_id = :accountId', { accountId })
      .getCount();
  }

  async create(data: Partial<User>) {
    const user = this.repository.create(data);
    return await this.repository.save(user);
  }

  async update(id: string, data: Partial<User>) {
    await this.repository.update(id, data);
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
