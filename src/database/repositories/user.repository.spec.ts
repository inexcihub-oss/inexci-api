import { UserRepository } from './user.repository';

/**
 * Regressão do C1 (revisão final `feat/modulo-atendimento`): o assistente do
 * WhatsApp resolve o usuário via `findOneByPhone`, que por muito tempo
 * delegou para `findOne`. O `select` de `findOne` tem ~26 colunas e NÃO
 * inclui `permissions` — com `select` parcial o TypeORM devolve a
 * propriedade como `undefined`, então `resolveEffectivePermissions` recebia
 * `permissions: undefined` e qualquer colaborador não-médico perdia acesso a
 * todas as tools com `requiredPermission`.
 *
 * `findOneByPhone` agora delega para `findOneWithProfile` (que inclui
 * `permissions`). Este teste trava as duas pontas:
 *  - `findOneByPhone` usa o `select` de `findOneWithProfile` (com `permissions`).
 *  - `findOne` continua SEM `permissions` no `select` — não pode ser ampliado
 *    para incluir a coluna crua, porque tem dezenas de chamadores fora do
 *    módulo de IA (ex.: `UsersService.findOne`, que devolve o resultado
 *    direto numa resposta HTTP sem filtrar `permissions`/`isPlatformAdmin`)
 *    e ampliar o `select` vazaria a coluna crua fora das rotas gated por
 *    `ADMINISTRACAO` (ver I2 do PLANO-PERMISSOES-COLABORADORES).
 */
describe('UserRepository', () => {
  function buildRepo() {
    const mockRepository = { findOne: jest.fn().mockResolvedValue(null) };
    const repo = new UserRepository(mockRepository as never);
    return { repo, mockRepository };
  }

  it('findOneByPhone consulta com select que inclui `permissions`', async () => {
    const { repo, mockRepository } = buildRepo();

    await repo.findOneByPhone('+5511999999999');

    expect(mockRepository.findOne).toHaveBeenCalledTimes(1);
    const call = mockRepository.findOne.mock.calls[0][0];
    expect(call.where).toEqual({ phone: '+5511999999999' });
    expect(call.select).toMatchObject({ permissions: true });
  });

  it('findOne (genérico) NÃO inclui `permissions` no select', async () => {
    const { repo, mockRepository } = buildRepo();

    await repo.findOne({ id: 'user-1' });

    const call = mockRepository.findOne.mock.calls[0][0];
    expect(call.select).not.toHaveProperty('permissions');
  });

  it('findOneWithProfile inclui `permissions` no select', async () => {
    const { repo, mockRepository } = buildRepo();

    await repo.findOneWithProfile({ id: 'user-1' });

    const call = mockRepository.findOne.mock.calls[0][0];
    expect(call.select).toMatchObject({ permissions: true });
  });
});
