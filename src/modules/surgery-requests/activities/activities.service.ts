import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SurgeryRequestActivityRepository } from 'src/database/repositories/surgery-request-activity.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { ActivityType } from 'src/database/entities/surgery-request-activity.entity';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UserRole } from 'src/database/entities/user.entity';
import { StorageService } from 'src/shared/storage/storage.service';

@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(
    private readonly activityRepository: SurgeryRequestActivityRepository,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly userRepository: UserRepository,
    private readonly storageService: StorageService,
  ) {}

  async findAll(surgeryRequestId: string, userId: string) {
    // Verifica acesso
    await this.loadRequest(surgeryRequestId, userId);

    const activities =
      await this.activityRepository.findBySurgeryRequest(surgeryRequestId);

    return Promise.all(
      activities.map(async (a) => {
        let content = a.content;
        let pdf_url: string | undefined;

        if (a.type === ActivityType.PDF_GENERATED) {
          try {
            const parsed = JSON.parse(a.content);
            content = parsed.description ?? a.content;
            if (parsed.pdf_path) {
              pdf_url = await this.storageService.getSignedUrl(parsed.pdf_path);
            }
          } catch {
            // conteúdo não é JSON — usa o texto bruto
            this.logger.warn(`Atividade ${a.id}: conteúdo não é JSON válido, usando texto bruto`);
          }
        }

        return {
          id: a.id,
          type: a.type,
          content,
          pdf_url,
          created_at: a.created_at,
          user: a.user
            ? {
                id: a.user.id,
                name: a.user.name,
                avatar_url: a.user.avatar_url,
              }
            : null,
        };
      }),
    );
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
