import { NotFoundException } from '@nestjs/common';

describe('UsersService.findOne — IDOR cross-tenant', () => {
  it('admin nao le usuario de outra clinica', async () => {
    const admin = { id: 'admin-a', role: 'admin', ownerId: 'clinica-a' };

    const userRepository = {
      findOne: jest.fn().mockImplementation((where: any) => {
        if (where.id === 'admin-a') return Promise.resolve(admin);
        // Com o filtro de ownerId correto, o alvo de outra clinica nao e achado.
        if (where.id === 'medico-clinica-b' && where.ownerId === 'clinica-a') {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      }),
    };

    const { UsersService } = await import('./users.service');
    const service = Object.create(UsersService.prototype);
    (service as any).userRepository = userRepository;

    await expect(
      service.findOne('medico-clinica-b', 'admin-a'),
    ).rejects.toThrow(NotFoundException);

    // A busca do alvo precisa incluir ownerId.
    const chamadaDoAlvo = userRepository.findOne.mock.calls.find(
      ([w]: any) => w.id === 'medico-clinica-b',
    );
    expect(chamadaDoAlvo?.[0]).toHaveProperty('ownerId', 'clinica-a');
  });
});
