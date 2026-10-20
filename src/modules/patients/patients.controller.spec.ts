import { Reflector } from '@nestjs/core';
import { ALL_PERMISSIONS, Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { PatientsController } from './patients.controller';

describe('PatientsController — permissões declaradas', () => {
  const reflector = new Reflector();

  const exigidoEm = (metodo: keyof PatientsController) =>
    reflector.get<Permission[]>(
      PERMISSIONS_KEY,
      PatientsController.prototype[metodo],
    );

  it('exige ao menos uma área na classe (RequireAnyArea) — transversal, mas fail-closed', () => {
    expect(reflector.get(PERMISSIONS_KEY, PatientsController)).toEqual([
      ...ALL_PERMISSIONS,
    ]);
  });

  it.each(['delete', 'bulkDelete'] as const)(
    'exige administração em %s',
    (metodo) => {
      expect(exigidoEm(metodo)).toEqual([Permission.ADMINISTRACAO]);
    },
  );

  it.each(['findAll', 'findOne', 'create', 'update'] as const)(
    'não sobrescreve a classe em %s (herda RequireAnyArea)',
    (metodo) => {
      expect(exigidoEm(metodo)).toBeUndefined();
    },
  );
});

describe('PatientsController — resposta do cadastro', () => {
  it('POST /patients devolve o paciente com a URL da foto (createWithPhoto)', async () => {
    const criado = { id: 'pac-1', photoUrl: 'https://r2/foto.png' };
    const service = {
      create: jest.fn(),
      createWithPhoto: jest.fn().mockResolvedValue(criado),
    };
    const controller = new PatientsController(service as never);

    const resposta = await controller.create({ name: 'Maria' }, {
      userId: 'user-1',
      permissions: ['agenda'],
    } as never);

    expect(resposta).toBe(criado);
    expect(service.createWithPhoto).toHaveBeenCalledWith(
      { name: 'Maria' },
      'user-1',
      ['agenda'],
    );
    expect(service.create).not.toHaveBeenCalled();
  });
});

describe('PatientsController — leitura repassa as permissões efetivas', () => {
  it('GET /patients/:id envia as permissões ao service', async () => {
    const service = { findOneWithPhoto: jest.fn().mockResolvedValue({}) };
    const controller = new PatientsController(service as never);

    await controller.findOne('pac-1', {
      userId: 'user-1',
      permissions: ['agenda'],
    } as never);

    expect(service.findOneWithPhoto).toHaveBeenCalledWith('pac-1', 'user-1', [
      'agenda',
    ]);
  });

  it('PATCH /patients/:id envia as permissões ao service', async () => {
    const service = { updateWithPhoto: jest.fn().mockResolvedValue({}) };
    const controller = new PatientsController(service as never);

    await controller.update('pac-1', { name: 'X' }, {
      userId: 'user-1',
      permissions: ['atendimento'],
    } as never);

    expect(service.updateWithPhoto).toHaveBeenCalledWith(
      'pac-1',
      { name: 'X' },
      'user-1',
      ['atendimento'],
    );
  });
});
