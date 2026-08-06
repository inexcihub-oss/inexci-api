import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotificationsGateway } from './notifications.gateway';
import { JwtService } from '@nestjs/jwt';
import { NotificationRepository } from 'src/database/repositories/notification.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { NotificationType } from 'src/database/entities/notification.entity';
import { UserStatus } from 'src/database/entities/user.entity';

const makeSocket = (token?: string): any => ({
  handshake: { auth: { token } },
  data: {},
  join: jest.fn(),
  disconnect: jest.fn(),
  emit: jest.fn(),
});

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;
  let jwtService: { verify: jest.Mock };
  let notificationRepository: { countUnread: jest.Mock };
  let userRepository: { findOne: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    jwtService = { verify: jest.fn() };
    notificationRepository = {
      countUnread: jest.fn().mockResolvedValue(0),
    };
    userRepository = {
      findOne: jest.fn().mockResolvedValue({ status: UserStatus.ACTIVE }),
    };
    configService = {
      get: jest.fn((_key: string, fallback?: unknown) => fallback),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsGateway,
        { provide: JwtService, useValue: jwtService },
        {
          provide: NotificationRepository,
          useValue: notificationRepository,
        },
        { provide: ConfigService, useValue: configService },
        { provide: UserRepository, useValue: userRepository },
      ],
    }).compile();

    gateway = module.get<NotificationsGateway>(NotificationsGateway);
    // Simula o servidor Socket.IO
    (gateway as any).server = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };
  });

  it('deve estar definido', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection', () => {
    it('autentica cliente válido e o coloca na room correta', async () => {
      const client = makeSocket('valid-token');
      jwtService.verify.mockReturnValue({ userId: 'user-123' });

      await gateway.handleConnection(client);

      expect(client.data.userId).toBe('user-123');
      expect(client.join).toHaveBeenCalledWith('user:user-123');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('emite contagem inicial de não lidas após autenticar', async () => {
      const client = makeSocket('valid-token');
      jwtService.verify.mockReturnValue({ userId: 'user-123' });
      notificationRepository.countUnread.mockResolvedValue(7);

      await gateway.handleConnection(client);

      expect(notificationRepository.countUnread).toHaveBeenCalledWith(
        'user-123',
      );
      expect(client.emit).toHaveBeenCalledWith('notification:unread-count', {
        count: 7,
      });
    });

    it('não derruba a conexão se countUnread falhar', async () => {
      const client = makeSocket('valid-token');
      jwtService.verify.mockReturnValue({ userId: 'user-123' });
      notificationRepository.countUnread.mockRejectedValue(new Error('db'));

      await gateway.handleConnection(client);

      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.join).toHaveBeenCalledWith('user:user-123');
    });

    it('desconecta cliente sem token', async () => {
      const client = makeSocket(undefined);

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });

    it('desconecta cliente com token inválido', async () => {
      const client = makeSocket('bad-token');
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid');
      });

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });

    it('valida issuer e audience ao verificar o token', async () => {
      const client = makeSocket('valid-token');
      jwtService.verify.mockReturnValue({ userId: 'user-123' });

      await gateway.handleConnection(client);

      expect(jwtService.verify).toHaveBeenCalledWith(
        'valid-token',
        expect.objectContaining({
          issuer: 'inexci-api',
          audience: 'inexci-app',
        }),
      );
    });

    it('desconecta usuário desativado mesmo com token válido', async () => {
      const client = makeSocket('valid-token');
      jwtService.verify.mockReturnValue({ userId: 'user-123' });
      userRepository.findOne.mockResolvedValue({
        status: UserStatus.INACTIVE,
      });

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });

    it('desconecta quando o usuário não existe mais', async () => {
      const client = makeSocket('valid-token');
      jwtService.verify.mockReturnValue({ userId: 'ghost' });
      userRepository.findOne.mockResolvedValue(null);

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('emitToUser', () => {
    it('emite evento para a room do usuário', () => {
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
      (gateway as any).server = { to: mockTo };

      const payload = {
        id: 'notif-1',
        type: NotificationType.INFO,
        title: 'Título',
        message: 'Mensagem',
        createdAt: new Date(),
      };

      gateway.emitToUser('user-abc', payload);

      expect(mockTo).toHaveBeenCalledWith('user:user-abc');
      expect(mockEmit).toHaveBeenCalledWith('notification:new', payload);
    });
  });

  describe('emitUnreadCount', () => {
    it('envia o total de não lidas para a room do usuário', () => {
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
      (gateway as any).server = { to: mockTo };

      gateway.emitUnreadCount('user-xyz', 4);

      expect(mockTo).toHaveBeenCalledWith('user:user-xyz');
      expect(mockEmit).toHaveBeenCalledWith('notification:unread-count', {
        count: 4,
      });
    });
  });
});
