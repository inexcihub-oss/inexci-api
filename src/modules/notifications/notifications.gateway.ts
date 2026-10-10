import { Logger, Optional } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Namespace, Socket } from 'socket.io';
import { NotificationType } from 'src/database/entities/notification.entity';
import { UserStatus } from 'src/database/entities/user.entity';
import { NotificationRepository } from 'src/database/repositories/notification.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import {
  JWT_DEFAULT_AUDIENCE,
  JWT_DEFAULT_ISSUER,
} from 'src/modules/auth/jwt-payload.interface';
import { errorMessage } from 'src/shared/utils';

export interface NotificationPayload {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
}

export interface DocumentExtractionStatusPayload {
  jobId: string;
  status: 'processing' | 'done' | 'error';
  result?: unknown;
  message?: string;
}

export interface SurgeryRequestChangedPayload {
  surgeryRequestId: string;
  action: 'created' | 'updated' | 'status-updated';
  actorId?: string;
  occurredAt: string;
}

@WebSocketGateway({ namespace: '/notifications', cors: { origin: '*' } })
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Namespace;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    @Optional()
    private readonly notificationRepository?: NotificationRepository,
    @Optional()
    private readonly configService?: ConfigService,
    @Optional()
    private readonly userRepository?: UserRepository,
  ) {}

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwtService.verify(token, {
        issuer: this.configService?.get<string>(
          'JWT_ISSUER',
          JWT_DEFAULT_ISSUER,
        ),
        audience: this.configService?.get<string>(
          'JWT_AUDIENCE',
          JWT_DEFAULT_AUDIENCE,
        ),
      });
      const userId: string = payload.userId;

      if (this.userRepository) {
        const user = await this.userRepository.findOne({ id: userId });
        if (!user || user.status !== UserStatus.ACTIVE) {
          client.disconnect();
          return;
        }
      }

      client.data.userId = userId;
      client.join(`user:${userId}`);
      this.logger.debug(`Client connected: user:${userId}`);

      if (this.notificationRepository) {
        try {
          const count = await this.notificationRepository.countUnread(userId);
          client.emit('notification:unread-count', { count });
        } catch (err: unknown) {
          this.logger.warn(
            `Falha ao enviar unread-count inicial para user:${userId}: ${errorMessage(err)}`,
          );
        }
      }
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    if (client.data?.userId) {
      this.logger.debug(`Client disconnected: user:${client.data.userId}`);
    }
  }

  emitToUser(userId: string, payload: NotificationPayload) {
    this.server.to(`user:${userId}`).emit('notification:new', payload);
  }

  emitUnreadCount(userId: string, count: number) {
    this.server.to(`user:${userId}`).emit('notification:unread-count', {
      count,
    });
  }

  emitDocumentExtractionStatus(
    userId: string,
    payload: DocumentExtractionStatusPayload,
  ) {
    this.server
      .to(`user:${userId}`)
      .emit('document-extraction:status', payload);
  }

  emitSurgeryRequestChanged(
    userIds: string[],
    payload: SurgeryRequestChangedPayload,
  ) {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    uniqueUserIds.forEach((userId) => {
      this.server.to(`user:${userId}`).emit('surgery-request:changed', payload);
    });
  }
}
