import { Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationsGateway } from 'src/modules/notifications/notifications.gateway';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { UserRole } from 'src/database/entities/user.entity';
import { AccessControlService } from 'src/shared/services/access-control.service';

export type SurgeryRequestRealtimeAction =
  | 'created'
  | 'updated'
  | 'status-updated';

@Injectable()
export class SurgeryRequestRealtimeService {
  private readonly logger = new Logger(SurgeryRequestRealtimeService.name);

  constructor(
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly userRepository: UserRepository,
    @Optional() private readonly notificationsGateway?: NotificationsGateway,
    @Optional() private readonly accessControlService?: AccessControlService,
  ) {}

  async broadcastChange(
    surgeryRequestId: string,
    action: SurgeryRequestRealtimeAction,
    actorId?: string,
  ): Promise<void> {
    if (!this.notificationsGateway) return;

    try {
      const request = await this.surgeryRequestRepository.findOneSimple({
        id: surgeryRequestId,
      });
      if (!request) return;

      const [allUsersInAccount, activityUserIds] = await Promise.all([
        this.userRepository.findByOwnerId(request.ownerId),
        this.surgeryRequestRepository.findDistinctActivityUserIds(
          surgeryRequestId,
        ),
      ]);

      let accessibleUserIds: string[] = [];

      if (this.accessControlService) {
        const checks = await Promise.all(
          allUsersInAccount.map(async (user) => {
            try {
              const doctorIds =
                await this.accessControlService!.getAccessibleDoctorIds(
                  user.id,
                );
              return {
                userId: user.id,
                canAccess: doctorIds.includes(request.doctorId),
              };
            } catch {
              return { userId: user.id, canAccess: false };
            }
          }),
        );

        accessibleUserIds = checks
          .filter((check) => check.canAccess)
          .map((check) => check.userId);
      } else {
        const adminIds = allUsersInAccount
          .filter((u) => u.role === UserRole.ADMIN)
          .map((u) => u.id);

        accessibleUserIds = [
          request.doctorId,
          request.createdById,
          ...adminIds,
        ];
      }

      const targetUserIds = [
        ...new Set(
          [
            ...accessibleUserIds,
            ...activityUserIds,
            request.createdById,
            request.doctorId,
            ...(actorId ? [actorId] : []),
          ].filter(Boolean),
        ),
      ];

      if (!targetUserIds.length) return;

      this.notificationsGateway.emitSurgeryRequestChanged(targetUserIds, {
        surgeryRequestId,
        action,
        actorId,
        occurredAt: new Date().toISOString(),
      });
    } catch (err: any) {
      this.logger.warn(
        `Falha ao emitir atualização em tempo real da SC ${surgeryRequestId}: ${err?.message}`,
      );
    }
  }
}
