import { Injectable, NotFoundException } from '@nestjs/common';
import { SurgeryRequestActivityRepository } from 'src/database/repositories/surgery-request-activity.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { ActivityType } from 'src/database/entities/surgery-request-activity.entity';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UserRole } from 'src/database/entities/user.entity';

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly activityRepository: SurgeryRequestActivityRepository,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly userRepository: UserRepository,
  ) {}

  async findAll(surgeryRequestId: string, userId: string) {
    // Verifica acesso
    await this.loadRequest(surgeryRequestId, userId);

    const activities =
      await this.activityRepository.findBySurgeryRequest(surgeryRequestId);

    return activities.map((a) => ({
      id: a.id,
      type: a.type,
      content: a.content,
      created_at: a.created_at,
      user: a.user
        ? { id: a.user.id, name: a.user.name, avatar_url: a.user.avatar_url }
        : null,
    }));
  }

  async create(
    surgeryRequestId: string,
    dto: CreateActivityDto,
    userId: string,
  ) {
    await this.loadRequest(surgeryRequestId, userId);

    const activity = await this.activityRepository.create({
      surgery_request_id: surgeryRequestId,
      user_id: userId,
      type: dto.type ?? ActivityType.COMMENT,
      content: dto.content,
    });

    const user = await this.userRepository.findOne({ id: userId });

    return {
      id: activity.id,
      type: activity.type,
      content: activity.content,
      created_at: activity.created_at,
      user: user
        ? { id: user.id, name: user.name, avatar_url: user.avatar_url }
        : null,
    };
  }

  private async loadRequest(surgeryRequestId: string, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const request = await this.surgeryRequestRepository.findOne({
      id: surgeryRequestId,
    });
    if (!request) throw new NotFoundException('Solicitação não encontrada.');

    // Admin tem acesso total
    if (user.role === UserRole.ADMIN) return request;

    return request;
  }
}
