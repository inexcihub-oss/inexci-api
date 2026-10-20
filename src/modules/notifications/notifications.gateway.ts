import { Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
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
  JwtPayload,
  JWT_DEFAULT_AUDIENCE,
  JWT_DEFAULT_ISSUER,
  tokenVersionValida,
} from 'src/modules/auth/jwt-payload.interface';
import { errorMessage } from 'src/shared/utils';
import {
  isAllowedOrigin,
  parseAllowedOrigins,
} from 'src/shared/bootstrap/allowed-origins';
import {
  USER_SESSIONS_REVOKED,
  UserSessionsRevokedEvent,
} from 'src/modules/auth/session-revocation.service';

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

const MAX_TIMER_MS = 2_147_483_647;

export function origemDoSocketPermitida(origin: string | undefined): boolean {
  if (!origin) return true;
  return isAllowedOrigin(origin, parseAllowedOrigins(process.env.CORS_ORIGINS));
}

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => callback(null, origemDoSocketPermitida(origin)),
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
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
    const origin = client.handshake.headers?.origin;
    if (!origemDoSocketPermitida(origin)) {
      this.logger.warn(
        `[WS_ORIGIN_BLOCKED] origin=${String(origin).slice(0, 200)}`,
      );
      client.disconnect(true);
      return;
    }

    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
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
        if (
          !user ||
          user.status !== UserStatus.ACTIVE ||
          !tokenVersionValida(payload, user.tokenVersion)
        ) {
          client.disconnect(true);
          return;
        }
      }

      if (client.disconnected) return;

      client.data.userId = userId;
      this.agendarExpiracao(client, payload.exp);
      void client.join(`user:${userId}`);
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
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.limparExpiracao(client);
    if (client.data?.userId) {
      this.logger.debug(`Client disconnected: user:${client.data.userId}`);
    }
  }

  onModuleDestroy() {
    for (const timer of this.expiryTimers) {
      clearTimeout(timer);
    }
    this.expiryTimers.clear();
  }

  @OnEvent(USER_SESSIONS_REVOKED)
  onSessionsRevoked(event: UserSessionsRevokedEvent): void {
    this.desconectarUsuario(event.userId, `sessions_revoked:${event.reason}`);
  }

  @OnEvent('user.access_changed')
  async onAccessChanged(event: { userId: string }): Promise<void> {
    if (!this.userRepository || !event?.userId) return;
    try {
      const user = await this.userRepository.findOne({ id: event.userId });
      if (!user || user.status !== UserStatus.ACTIVE) {
        this.desconectarUsuario(event.userId, 'access_changed');
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Falha ao reavaliar sockets de user:${event.userId}: ${errorMessage(err)}`,
      );
    }
  }

  desconectarUsuario(userId: string, motivo: string): void {
    if (!this.server || !userId) return;
    this.logger.log(`[WS_DISCONNECT_USER] user:${userId} motivo=${motivo}`);
    this.server.in(`user:${userId}`).disconnectSockets(true);
  }

  private readonly expiryTimers = new Set<NodeJS.Timeout>();

  private agendarExpiracao(client: Socket, exp: number | undefined): void {
    if (!exp) return;
    const restanteMs = Math.max(0, exp * 1000 - Date.now());
    const timer = setTimeout(
      () => {
        this.expiryTimers.delete(timer);
        client.emit('session:expired');
        client.disconnect(true);
      },
      Math.min(restanteMs, MAX_TIMER_MS),
    );
    timer.unref?.();
    this.expiryTimers.add(timer);
    client.data.expiryTimer = timer;
  }

  private limparExpiracao(client: Socket): void {
    const timer = client.data?.expiryTimer as NodeJS.Timeout | undefined;
    if (!timer) return;
    clearTimeout(timer);
    this.expiryTimers.delete(timer);
    client.data.expiryTimer = undefined;
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
