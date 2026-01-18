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
        clinic_id: true,
        pv: true,
        status: true,
        email: true,
        name: true,
        phone: true,
        password: selectPassword,
        birth_date: true,
        gender: true,
        document: true,
        company: true,
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
        clinic_id: true,
        status: true,
        email: true,
        name: true,
        phone: true,
        gender: true,
        birth_date: true,
        document: true,
        created_at: true,
      },
    });
  }

  async create(data: Partial<User>) {
    const user = this.repository.create(data);
    return await this.repository.save(user);
  }

  async update(id: number, data: Partial<User>) {
    await this.repository.update(id, data);
    return await this.repository.findOne({ where: { id } });
  }
}
