import { ConfigService } from '@nestjs/config';
import { UserRole, UserStatus } from 'src/database/entities/user.entity';
import { Permission } from 'src/shared/permissions';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy — permissões', () => {
  const userRepository = { findOneWithProfile: jest.fn() };
  const configService = {
    get: jest.fn((chave: string, padrao?: string) =>
      chave === 'JWT_SECRET' ? 'segredo-de-teste' : padrao,
    ),
  } as unknown as ConfigService;

  const strategy = new JwtStrategy(configService, userRepository as never);

  beforeEach(() => jest.clearAllMocks());

  it('resolve a permissão efetiva do colaborador não-médico', async () => {
    userRepository.findOneWithProfile.mockResolvedValue({
      id: 'u-1',
      ownerId: 'o-1',
      role: UserRole.COLLABORATOR,
      status: UserStatus.ACTIVE,
      permissions: [Permission.AGENDA],
      doctorProfile: null,
    });

    const resultado = await strategy.validate({ userId: 'u-1' } as never);

    expect(resultado.permissions).toEqual([Permission.AGENDA]);
  });

  it('acrescenta atendimento e solicitações quando há doctorProfile', async () => {
    userRepository.findOneWithProfile.mockResolvedValue({
      id: 'u-2',
      ownerId: 'o-1',
      role: UserRole.COLLABORATOR,
      status: UserStatus.ACTIVE,
      permissions: [],
      doctorProfile: { id: 'dp-1' },
    });

    const resultado = await strategy.validate({ userId: 'u-2' } as never);

    expect(resultado.permissions).toEqual([
      Permission.ATENDIMENTO,
      Permission.SOLICITACOES,
    ]);
  });

  it('dá as quatro ao dono da conta', async () => {
    userRepository.findOneWithProfile.mockResolvedValue({
      id: 'o-1',
      ownerId: 'o-1',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      permissions: [],
      doctorProfile: null,
    });

    const resultado = await strategy.validate({ userId: 'o-1' } as never);

    expect(resultado.permissions).toHaveLength(4);
  });
});
