import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SurgeryRequestActivityRepository } from 'src/database/repositories/surgery-request-activity.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { ActivityType } from 'src/database/entities/surgery-request-activity.entity';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UserRole } from 'src/database/entities/user.entity';
import { StorageService } from 'src/shared/storage/storage.service';
import { SurgeryRequestActivityMentionRepository } from 'src/database/repositories/surgery-request-activity-mention.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { ActivityMentionsService } from './mentions/activity-mentions.service';

@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(
    private readonly activityRepository: SurgeryRequestActivityRepository,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly userRepository: UserRepository,
    private readonly storageService: StorageService,
    private readonly mentionRepository: SurgeryRequestActivityMentionRepository,
    private readonly accessControlService: AccessControlService,
    private readonly mentionsService: ActivityMentionsService,
  ) {}

  async findAll(surgeryRequestId: string, userId: string) {
    // Verifica acesso
    await this.loadRequest(surgeryRequestId, userId);

    const activities =
      await this.activityRepository.findBySurgeryRequest(surgeryRequestId);

    // Uma consulta só para todas as atividades — uma por atividade seria
    // N+1 numa aba que costuma ter dezenas de linhas.
    const mentions = await this.mentionRepository.findByActivityIds(
      activities.map((a) => a.id),
    );
    const mentionsPorAtividade = new Map<
      string,
      { id: string; name: string }[]
    >();
    for (const mention of mentions) {
      const lista = mentionsPorAtividade.get(mention.activityId) ?? [];
      lista.push({
        id: mention.mentionedUserId,
        name: mention.mentionedUser?.name ?? '',
      });
      mentionsPorAtividade.set(mention.activityId, lista);
    }

    return Promise.all(
      activities.map(async (a) => {
        let content = a.content;
        let pdfUrl: string | undefined;

        if (a.type === ActivityType.PDF_GENERATED) {
          try {
            const parsed = JSON.parse(a.content);
            content = parsed.description ?? a.content;
            if (parsed.pdf_path) {
              pdfUrl = await this.storageService.getSignedUrl(parsed.pdf_path);
            }
          } catch {
            // conteúdo não é JSON — usa o texto bruto
            this.logger.warn(
              `Atividade ${a.id}: conteúdo não é JSON válido, usando texto bruto`,
            );
          }
        }

        return {
          id: a.id,
          type: a.type,
          content,
          pdfUrl,
          mentions: mentionsPorAtividade.get(a.id) ?? [],
          createdAt: a.createdAt,
          user: a.user
            ? {
                id: a.user.id,
                name: a.user.name,
                avatarUrl: a.user.avatarUrl,
              }
            : null,
        };
      }),
    );
  }

  /**
   * Usuários que podem ser mencionados nos comentários desta SC.
   *
   * O autor sai da lista: mencionar a si mesmo só geraria uma notificação
   * para quem acabou de escrever o comentário.
   */
  async findMentionableUsers(surgeryRequestId: string, userId: string) {
    const request = await this.loadRequest(surgeryRequestId, userId);

    const usuarios = await this.accessControlService.getUsersWithAccessToDoctor(
      request.doctorId,
      request.ownerId,
    );

    return usuarios
      .filter((usuario) => usuario.id !== userId)
      .map((usuario) => ({
        id: usuario.id,
        name: usuario.name,
        avatarUrl: usuario.avatarUrl ?? null,
      }));
  }

  async create(
    surgeryRequestId: string,
    dto: CreateActivityDto,
    userId: string,
  ) {
    const request = await this.loadRequest(surgeryRequestId, userId);

    const activity = await this.activityRepository.create({
      surgeryRequestId: surgeryRequestId,
      userId: userId,
      type: dto.type ?? ActivityType.COMMENT,
      content: dto.content,
    });

    const user = await this.userRepository.findOne({ id: userId });

    const mentions = await this.mentionsService.register({
      activityId: activity.id,
      surgeryRequestId,
      doctorUserId: request.doctorId,
      ownerId: request.ownerId,
      authorId: userId,
      authorName: user?.name ?? 'Alguém',
      content: dto.content,
      mentionedUserIds: dto.mentionedUserIds ?? [],
    });

    return {
      id: activity.id,
      type: activity.type,
      content: activity.content,
      mentions,
      createdAt: activity.createdAt,
      user: user
        ? { id: user.id, name: user.name, avatarUrl: user.avatarUrl }
        : null,
    };
  }

  private async loadRequest(surgeryRequestId: string, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const request = await this.surgeryRequestRepository.findOneSimple({
      id: surgeryRequestId,
    });
    if (!request) throw new NotFoundException('Solicitação não encontrada.');

    // Admin tem acesso total
    if (user.role === UserRole.ADMIN) return request;

    return request;
  }
}
