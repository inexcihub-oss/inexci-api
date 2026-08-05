import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateCollaboratorDto } from './update-collaborator.dto';
import { Permission } from 'src/shared/permissions';

/**
 * Tarefa 13 — grava e devolve as permissões do colaborador.
 * Cobre especificamente `permissions`: o service distingue `undefined`
 * ("não mexi") de `[]` ("retirei todas"), então a validação do DTO precisa
 * deixar `undefined` passar sem checar o enum, mas rejeitar `null` (que
 * senão seguiria como "mexeu" e estouraria a constraint `NOT NULL` da
 * coluna no banco).
 */
describe('UpdateCollaboratorDto', () => {
  it('deve validar sem nenhum campo (tudo opcional)', async () => {
    const dto = plainToInstance(UpdateCollaboratorDto, {});

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  describe('permissions', () => {
    it('deve aceitar valores válidos do enum Permission', async () => {
      const dto = plainToInstance(UpdateCollaboratorDto, {
        permissions: [Permission.ATENDIMENTO],
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('deve aceitar array vazio (retirar todas as permissões)', async () => {
      const dto = plainToInstance(UpdateCollaboratorDto, { permissions: [] });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('deve aceitar sem permissions (omitido — não mexer)', async () => {
      const dto = plainToInstance(UpdateCollaboratorDto, { name: 'Novo' });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('deve falhar com valor fora do enum Permission', async () => {
      const dto = plainToInstance(UpdateCollaboratorDto, {
        permissions: ['area-inexistente'],
      });

      const errors = await validate(dto);
      const permissionsError = errors.find((e) => e.property === 'permissions');
      expect(permissionsError).toBeDefined();
      expect(permissionsError?.constraints).toHaveProperty('isEnum');
    });

    it('deve falhar com permissions null explícito', async () => {
      const dto = plainToInstance(UpdateCollaboratorDto, {
        permissions: null,
      });

      const errors = await validate(dto);
      const permissionsError = errors.find((e) => e.property === 'permissions');
      expect(permissionsError).toBeDefined();
    });
  });
});
