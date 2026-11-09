import {
  ACCOUNT_STATUS_CACHE_TTL_MS,
  AccountStatusService,
} from './account-status.service';

function build(deactivated = true) {
  const userRepository = {
    isAccountDeactivated: jest.fn().mockResolvedValue(deactivated),
  };
  const service = new AccountStatusService(userRepository as never);
  return { service, userRepository };
}

describe('AccountStatusService', () => {
  it('sem conta (envio fora de tenant) não consulta e libera', async () => {
    const { service, userRepository } = build();

    await expect(service.isDeactivated(null)).resolves.toBe(false);
    await expect(service.isDeactivated(undefined)).resolves.toBe(false);
    expect(userRepository.isAccountDeactivated).not.toHaveBeenCalled();
  });

  it('consulta o dono e guarda o resultado por um intervalo curto', async () => {
    const { service, userRepository } = build(true);

    await expect(service.isDeactivated('owner-1', 1000)).resolves.toBe(true);
    await expect(service.isDeactivated('owner-1', 2000)).resolves.toBe(true);

    expect(userRepository.isAccountDeactivated).toHaveBeenCalledTimes(1);
    expect(userRepository.isAccountDeactivated).toHaveBeenCalledWith('owner-1');
  });

  it('consulta de novo depois que o cache expira', async () => {
    const { service, userRepository } = build(true);

    await service.isDeactivated('owner-1', 1000);
    userRepository.isAccountDeactivated.mockResolvedValue(false);

    await expect(
      service.isDeactivated('owner-1', 1000 + ACCOUNT_STATUS_CACHE_TTL_MS + 1),
    ).resolves.toBe(false);
    expect(userRepository.isAccountDeactivated).toHaveBeenCalledTimes(2);
  });

  it('com o banco fora, não bloqueia o envio e não guarda nada no cache', async () => {
    const { service, userRepository } = build();
    userRepository.isAccountDeactivated.mockRejectedValueOnce(new Error('db'));

    await expect(service.isDeactivated('owner-1', 1000)).resolves.toBe(false);
    await expect(service.isDeactivated('owner-1', 1001)).resolves.toBe(true);
    expect(userRepository.isAccountDeactivated).toHaveBeenCalledTimes(2);
  });
});
