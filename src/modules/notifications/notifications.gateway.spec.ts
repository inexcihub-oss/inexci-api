import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotificationsGateway } from './notifications.gateway';
import { JwtService } from '@nestjs/jwt';
import { NotificationRepository } from 'src/database/repositories/notification.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { NotificationType } from 'src/database/entities/notification.entity';
import { UserStatus } from 'src/database/entities/user.entity';

const makeSocket = (token?: string, origin?: string): any => ({
  handshake: { auth: { token }, headers: origin ? { origin } : {} },
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

  describe('endurecimento da sessão no socket', () => {
    const corsOriginal = process.env.CORS_ORIGINS;

    beforeEach(() => {
      process.env.CORS_ORIGINS = 'https://app.inexci.com.br';
    });

    afterEach(() => {
      process.env.CORS_ORIGINS = corsOriginal;
      jest.useRealTimers();
      gateway.onModuleDestroy();
    });

    it('recusa handshake de origem fora de CORS_ORIGINS antes de verificar o token', async () => {
      const client = makeSocket('valid-token', 'https://evil.example');

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(jwtService.verify).not.toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });

    it('aceita a origem do frontend', async () => {
      const client = makeSocket('valid-token', 'https://app.inexci.com.br');
      jwtService.verify.mockReturnValue({ userId: 'user-123' });

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('user:user-123');
    });

    it('recusa token emitido antes da revogação das sessões (tokenVersion)', async () => {
      const client = makeSocket('valid-token');
      jwtService.verify.mockReturnValue({ userId: 'user-123', tv: 1 });
      userRepository.findOne.mockResolvedValue({
        status: UserStatus.ACTIVE,
        tokenVersion: 2,
      });

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('desconecta o socket quando o access token expira', async () => {
      jest.useFakeTimers();
      const agora = Date.now();
      jest.setSystemTime(agora);
      const client = makeSocket('valid-token');
      jwtService.verify.mockReturnValue({
        userId: 'user-123',
        exp: Math.floor(agora / 1000) + 60,
      });

      await gateway.handleConnection(client);
      expect(client.disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(59_000);
      expect(client.disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(2_000);
      expect(client.emit).toHaveBeenCalledWith('session:expired');
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('cancela o timer de expiração quando o cliente sai antes', async () => {
      jest.useFakeTimers();
      const client = makeSocket('valid-token');
      jwtService.verify.mockReturnValue({
        userId: 'user-123',
        exp: Math.floor(Date.now() / 1000) + 60,
      });

      await gateway.handleConnection(client);
      gateway.handleDisconnect(client);
      jest.advanceTimersByTime(120_000);

      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('derruba todos os sockets do usuário quando as sessões são revogadas', () => {
      const disconnectSockets = jest.fn();
      const mockIn = jest.fn().mockReturnValue({ disconnectSockets });
      (gateway as any).server = { in: mockIn };

      gateway.onSessionsRevoked({
        userId: 'user-9',
        reason: 'password_changed',
        accessTokensRevoked: true,
      });

      expect(mockIn).toHaveBeenCalledWith('user:user-9');
      expect(disconnectSockets).toHaveBeenCalledWith(true);
    });

    it('user.access_changed só derruba os sockets se a conta deixou de estar ativa', async () => {
      const disconnectSockets = jest.fn();
      (gateway as any).server = {
        in: jest.fn().mockReturnValue({ disconnectSockets }),
      };

      userRepository.findOne.mockResolvedValueOnce({
        status: UserStatus.ACTIVE,
      });
      await gateway.onAccessChanged({ userId: 'user-9' });
      expect(disconnectSockets).not.toHaveBeenCalled();

      userRepository.findOne.mockResolvedValueOnce({
        status: UserStatus.INACTIVE,
      });
      await gateway.onAccessChanged({ userId: 'user-9' });
      expect(disconnectSockets).toHaveBeenCalledWith(true);
    });
  });
});
