import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { UserNotificationSettings } from '../entities/user-notification-settings.entity';

@Global()
@Injectable()
export class UserNotificationSettingsRepository {
  constructor(
    @InjectRepository(UserNotificationSettings)
    private readonly repository: Repository<UserNotificationSettings>,
  ) {}

  async findOne(
    where: FindOptionsWhere<UserNotificationSettings>,
  ): Promise<UserNotificationSettings | null> {
    return await this.repository.findOne({ where });
  }

  async findByUserId(userId: number): Promise<UserNotificationSettings | null> {
    return await this.repository.findOne({ where: { user_id: userId } });
  }

  async create(
    data: Partial<UserNotificationSettings>,
  ): Promise<UserNotificationSettings> {
    const entity = this.repository.create(data);
    return await this.repository.save(entity);
  }

  async update(
    userId: number,
    data: Partial<UserNotificationSettings>,
  ): Promise<UserNotificationSettings> {
    await this.repository.update({ user_id: userId }, data);
    return await this.findByUserId(userId);
  }

  async upsert(
    userId: number,
    data: Partial<UserNotificationSettings>,
  ): Promise<UserNotificationSettings> {
    const existing = await this.findByUserId(userId);
    if (existing) {
      return await this.update(userId, data);
    } else {
      return await this.create({ ...data, user_id: userId });
    }
  }
}
