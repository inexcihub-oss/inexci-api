describe('Troca de senha — revogacao de sessoes', () => {
  it('revoga refresh tokens ao concluir a recuperacao', async () => {
    const refreshTokenStore = { revokeAllForUser: jest.fn() };
    const userRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'user-1', email: 'a@b.com' }),
      update: jest.fn(),
    };
    const recoveryCodeRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'rec-1',
        userId: 'user-1',
        used: true,
        attempts: 0,
        resetToken: 'token-valido',
        resetTokenExpiresAt: new Date(Date.now() + 600_000),
        expiresAt: new Date(Date.now() + 600_000),
      }),
      deleteMany: jest.fn(),
      update: jest.fn(),
    };

    const { AuthService } = await import('./auth.service');
    const service = Object.create(AuthService.prototype);
    Object.assign(service, {
      refreshTokenStore,
      userRepository,
      recoveryCodeRepository,
    });
    // revokeRefreshTokens (auth.service.ts:611) apenas delega ao store; o
    // teste observa o store para nao depender do wrapper.

    await service.changePassword({
      email: 'a@b.com',
      resetToken: 'token-valido',
      password: 'SenhaForte123@',
    } as any);

    expect(refreshTokenStore.revokeAllForUser).toHaveBeenCalledWith('user-1');
  });
});
