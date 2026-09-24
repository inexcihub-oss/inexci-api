import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
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

  /**
   * Reserva o envio do e-mail: carimba `email_sent_at` só se ainda estiver
   * vazio, num único UPDATE. Devolve `false` quando outra tentativa do job
   * já reservou — é o que impede o retry do Bull de mandar o e-mail de novo.
   */
  async claimEmailSend(id: string): Promise<boolean> {
    const result = await this.repository.update(
      { id, emailSentAt: IsNull() },
      { emailSentAt: new Date() },
    );
    return (result.affected ?? 0) > 0;
  }

  /** Desfaz a reserva quando o envio falhou, para o retry poder tentar. */
  async releaseEmailSend(id: string): Promise<void> {
    await this.repository.update(id, { emailSentAt: null });
  }
}
