import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { User } from '../entities/user.entity';

@Global()
@Injectable()
export class UserRepository {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  async total(where: FindOptionsWhere<User> | FindOptionsWhere<User>[]) {
    return await this.repository.count({ where });
  }

  async findOne(
    where: FindOptionsWhere<User> | FindOptionsWhere<User>[],
    selectPassword = false,
  ) {
    return await this.repository.findOne({
      where,
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
        is_admin: true,
        is_doctor: true,
        crm: true,
        crm_state: true,
        specialty: true,
        signature_image_url: true,
        subscription_plan_id: true,
        admin_id: true,
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
        is_admin: true,
        is_doctor: true,
        crm: true,
        crm_state: true,
        specialty: true,
        signature_image_url: true,
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
        is_admin: true,
        is_doctor: true,
        crm: true,
        crm_state: true,
        specialty: true,
        subscription_plan_id: true,
        admin_id: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  async findManyByAdminId(adminId: string, skip: number, take: number) {
    return await this.repository.find({
      where: { admin_id: adminId },
      skip,
      take,
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
        is_admin: true,
        is_doctor: true,
        crm: true,
        crm_state: true,
        specialty: true,
        admin_id: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  async countDoctorsByAdminId(adminId: string): Promise<number> {
    return await this.repository.count({
      where: { admin_id: adminId, is_doctor: true },
    });
  }

  async create(data: Partial<User>) {
    const user = this.repository.create(data);
    return await this.repository.save(user);
  }

  async update(id: string, data: Partial<User>) {
    await this.repository.update(id, data);
    return await this.findOne({ id });
  }

  async delete(id: string) {
    return await this.repository.delete(id);
  }
}
