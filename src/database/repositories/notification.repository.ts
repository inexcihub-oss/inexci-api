import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, LessThan } from 'typeorm';
import {
  Notification,
  NotificationType,
} from '../entities/notification.entity';

@Global()
@Injectable()
export class NotificationRepository {
  constructor(
    @InjectRepository(Notification)
    private readonly repository: Repository<Notification>,
  ) {}

  async findOne(
    where: FindOptionsWhere<Notification>,
  ): Promise<Notification | null> {
    return await this.repository.findOne({ where });
  }

  async findByUserId(
    userId: number,
    options?: { skip?: number; take?: number; unreadOnly?: boolean },
  ): Promise<Notification[]> {
    const where: FindOptionsWhere<Notification> = { user_id: userId };

    if (options?.unreadOnly) {
      where.read = false;
    }

    return await this.repository.find({
      where,
      order: { created_at: 'DESC' },
      skip: options?.skip || 0,
      take: options?.take || 50,
    });
  }

  async countUnread(userId: number): Promise<number> {
    return await this.repository.count({
      where: { user_id: userId, read: false },
    });
  }

  async create(data: Partial<Notification>): Promise<Notification> {
    const entity = this.repository.create(data);
    return await this.repository.save(entity);
  }

  async markAsRead(notificationId: number, userId: number): Promise<void> {
    await this.repository.update(
      { id: notificationId, user_id: userId },
      { read: true },
    );
  }

  async markAllAsRead(userId: number): Promise<void> {
    await this.repository.update(
      { user_id: userId, read: false },
      { read: true },
    );
  }

  async delete(notificationId: number, userId: number): Promise<void> {
    await this.repository.delete({ id: notificationId, user_id: userId });
  }

  async deleteOldNotifications(
    userId: number,
    olderThanDays: number,
  ): Promise<void> {
    const date = new Date();
    date.setDate(date.getDate() - olderThanDays);

    await this.repository.delete({
      user_id: userId,
      created_at: LessThan(date),
    });
  }

  async createBulk(
    notifications: Partial<Notification>[],
  ): Promise<Notification[]> {
    const entities = this.repository.create(notifications);
    return await this.repository.save(entities);
  }
}
