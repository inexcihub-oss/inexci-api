import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, LessThan } from 'typeorm';
import { Notification } from '../entities/notification.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class NotificationRepository extends BaseRepository<Notification> {
  constructor(
    @InjectRepository(Notification)
    repository: Repository<Notification>,
  ) {
    super(repository);
  }

  async findByUserId(
    userId: string,
    options?: { skip?: number; take?: number; unreadOnly?: boolean },
  ): Promise<Notification[]> {
    const where: FindOptionsWhere<Notification> = { userId };

    if (options?.unreadOnly) {
      where.read = false;
    }

    return await this.repository.find({
      where,
      order: { createdAt: 'DESC' },
      skip: options?.skip || 0,
      take: options?.take || 50,
    });
  }

  async countUnread(userId: string): Promise<number> {
    return await this.repository.count({
      where: { userId, read: false },
    });
  }

  async markAsRead(notificationId: string, userId: string): Promise<void> {
    await this.repository.update(
      { id: notificationId, userId },
      { read: true },
    );
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.repository.update({ userId, read: false }, { read: true });
  }

  async deleteByUser(notificationId: string, userId: string): Promise<void> {
    await this.repository.delete({ id: notificationId, userId });
  }

  async deleteOldNotifications(
    userId: string,
    olderThanDays: number,
  ): Promise<void> {
    const date = new Date();
    date.setDate(date.getDate() - olderThanDays);

    await this.repository.delete({
      userId,
      createdAt: LessThan(date),
    });
  }

  async createBulk(
    notifications: Partial<Notification>[],
  ): Promise<Notification[]> {
    const entities = this.repository.create(notifications);
    return await this.repository.save(entities);
  }
}
