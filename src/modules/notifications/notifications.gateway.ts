import { Logger, Optional } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Namespace, Socket } from 'socket.io';
import { NotificationType } from 'src/database/entities/notification.entity';
import { NotificationRepository } from 'src/database/repositories/notification.repository';

export interface NotificationPayload {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
  metadata?: Record<string, any> | null;
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

/**
 * Eventos emitidos para o cliente:
 *  - `notification:new` — nova notificação criada (payload completo).
 *  - `notification:unread-count` — contagem atual de não lidas. Emitido na
 *    conexão e sempre que muda no servidor (mark as read, delete, etc.).
 *  - `surgery-request:changed` — sinaliza criação/atualização de SC para
 *    sincronização de telas (kanban/lista) em tempo real.
 */
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
  ) {}

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwtService.verify(token);
      const userId: string = payload.userId;
      client.data.userId = userId;
      client.join(`user:${userId}`);
      this.logger.debug(`Client connected: user:${userId}`);

      // Envia o estado inicial via WebSocket — elimina a necessidade de o
      // frontend bater em /notifications/unread-count após o login.
      if (this.notificationRepository) {
        try {
          const count = await this.notificationRepository.countUnread(userId);
          client.emit('notification:unread-count', { count });
        } catch (err: any) {
          this.logger.warn(
            `Falha ao enviar unread-count inicial para user:${userId}: ${err?.message}`,
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

  /**
   * Emite a contagem de notificações não lidas para todos os clientes
   * conectados de um usuário. Usado após mudanças que alteram esse total.
   */
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
