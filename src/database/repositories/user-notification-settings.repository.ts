import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserNotificationSettings } from '../entities/user-notification-settings.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class UserNotificationSettingsRepository extends BaseRepository<UserNotificationSettings> {
  constructor(
    @InjectRepository(UserNotificationSettings)
    repository: Repository<UserNotificationSettings>,
  ) {
    super(repository);
  }

  async findByUserId(userId: string): Promise<UserNotificationSettings | null> {
    return await this.repository.findOne({ where: { user_id: userId } });
  }

  async update(
    userId: string,
    data: Partial<UserNotificationSettings>,
  ): Promise<UserNotificationSettings> {
    await this.repository.update({ user_id: userId }, data);
    return await this.findByUserId(userId);
  }

  async upsert(
    userId: string,
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
