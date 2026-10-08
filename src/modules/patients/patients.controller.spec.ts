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

  // Antes a classe não tinha decorator, o que liberava paciente (dado de saúde)
  // a QUALQUER autenticado — inclusive colaborador com `permissions: []`.
  // `@RequireAnyArea()` mantém a transversalidade (qualquer uma das 4 áreas)
  // fechando o buraco do zero-permissão.
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

  // findAll/findOne/create/update não têm decorator próprio: herdam o da classe
  // (RequireAnyArea) — qualquer área passa, zero-permissão é bloqueado.
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

    const resposta = await controller.create(
      { name: 'Maria' } as never,
      {
        userId: 'user-1',
      } as never,
    );

    expect(resposta).toBe(criado);
    expect(service.createWithPhoto).toHaveBeenCalledWith(
      { name: 'Maria' },
      'user-1',
    );
    expect(service.create).not.toHaveBeenCalled();
  });
});
