import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SurgeryRequestActivityMention } from '../entities/surgery-request-activity-mention.entity';
import { BaseRepository } from './base.repository';

@Injectable()
export class SurgeryRequestActivityMentionRepository extends BaseRepository<SurgeryRequestActivityMention> {
  constructor(
    @InjectRepository(SurgeryRequestActivityMention)
    repository: Repository<SurgeryRequestActivityMention>,
  ) {
    super(repository);
  }

  async createMany(
    activityId: string,
    mentionedUserIds: string[],
  ): Promise<SurgeryRequestActivityMention[]> {
    if (mentionedUserIds.length === 0) return [];

    const entities = this.repository.create(
      mentionedUserIds.map((mentionedUserId) => ({
        activityId,
        mentionedUserId,
      })),
    );

    return await this.repository.save(entities);
  }

  async findByActivityIds(
    activityIds: string[],
  ): Promise<SurgeryRequestActivityMention[]> {
    if (activityIds.length === 0) return [];

    return await this.repository.find({
      where: { activityId: In(activityIds) },
      relations: ['mentionedUser'],
    });
  }

  async findOneWithUser(
    id: string,
  ): Promise<SurgeryRequestActivityMention | null> {
    return await this.repository.findOne({
      where: { id },
      relations: ['mentionedUser', 'activity'],
    });
  }

  async setNotificationId(id: string, notificationId: string): Promise<void> {
    await this.repository.update(id, { notificationId });
  }

  async markEmailSent(id: string): Promise<void> {
    await this.repository.update(id, { emailSentAt: new Date() });
  }
}
