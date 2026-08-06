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
      // Valida issuer/audience como a JwtStrategy HTTP faz — um token emitido
      // para outro serviço/plateia não deve abrir o socket.
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

      // Revalida o usuário: um token continua válido por até 15 min após a
      // conta ser desativada; sem esta checagem, um usuário desativado
      // manteria o socket vivo recebendo notificações até o token expirar.
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
