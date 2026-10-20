import {
  SessionRevocationService,
  USER_SESSIONS_REVOKED,
} from './session-revocation.service';

describe('SessionRevocationService', () => {
  const refreshTokenStore = { revokeAllForUser: jest.fn() };
  const userRepository = { incrementTokenVersion: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const service = new SessionRevocationService(
    refreshTokenStore as never,
    userRepository as never,
    eventEmitter as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('revokeAllSessions invalida access tokens (tokenVersion), refresh tokens e avisa os sockets', async () => {
    await service.revokeAllSessions('user-1', 'password_changed');

    expect(userRepository.incrementTokenVersion).toHaveBeenCalledWith('user-1');
    expect(refreshTokenStore.revokeAllForUser).toHaveBeenCalledWith('user-1');
    expect(eventEmitter.emit).toHaveBeenCalledWith(USER_SESSIONS_REVOKED, {
      userId: 'user-1',
      reason: 'password_changed',
      accessTokensRevoked: true,
    });
  });

  it('a versão do token sobe antes de apagar os refresh tokens', async () => {
    const ordem: string[] = [];
    userRepository.incrementTokenVersion.mockImplementation(() => {
      ordem.push('tokenVersion');
    });
    refreshTokenStore.revokeAllForUser.mockImplementation(() => {
      ordem.push('refresh');
    });

    await service.revokeAllSessions('user-1', 'refresh_reuse');

    expect(ordem).toEqual(['tokenVersion', 'refresh']);
  });

  it('revokeRefreshTokens (logout) não mexe na versão do access token', async () => {
    await service.revokeRefreshTokens('user-1', 'logout');

    expect(userRepository.incrementTokenVersion).not.toHaveBeenCalled();
    expect(refreshTokenStore.revokeAllForUser).toHaveBeenCalledWith('user-1');
    expect(eventEmitter.emit).toHaveBeenCalledWith(USER_SESSIONS_REVOKED, {
      userId: 'user-1',
      reason: 'logout',
      accessTokensRevoked: false,
    });
  });
});
