import { UnauthorizedException } from '@nestjs/common';
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

    const resultado = await strategy.validate({ userId: 'u-1' });

    expect(resultado.permissions).toEqual([Permission.AGENDA]);
  });

  it('acrescenta agenda, atendimento e solicitações quando há doctorProfile', async () => {
    userRepository.findOneWithProfile.mockResolvedValue({
      id: 'u-2',
      ownerId: 'o-1',
      role: UserRole.COLLABORATOR,
      status: UserStatus.ACTIVE,
      permissions: [],
      doctorProfile: { id: 'dp-1', council: 'CRM' },
    });

    const resultado = await strategy.validate({ userId: 'u-2' });

    expect(resultado.permissions).toEqual([
      Permission.AGENDA,
      Permission.ATENDIMENTO,
      Permission.SOLICITACOES,
    ]);
  });

  it('dá as cinco ao dono da conta', async () => {
    userRepository.findOneWithProfile.mockResolvedValue({
      id: 'o-1',
      ownerId: 'o-1',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      permissions: [],
      doctorProfile: null,
    });

    const resultado = await strategy.validate({ userId: 'o-1' });

    expect(resultado.permissions).toHaveLength(5);
  });

  describe('tokenVersion', () => {
    const ativo = {
      id: 'u-3',
      ownerId: 'o-1',
      role: UserRole.COLLABORATOR,
      status: UserStatus.ACTIVE,
      permissions: [],
      doctorProfile: null,
    };

    it('aceita token sem claim tv enquanto a versão do usuário é 0', async () => {
      userRepository.findOneWithProfile.mockResolvedValue({
        ...ativo,
        tokenVersion: 0,
      });

      await expect(strategy.validate({ userId: 'u-3' })).resolves.toBeTruthy();
    });

    it('aceita token cuja tv bate com a versão atual', async () => {
      userRepository.findOneWithProfile.mockResolvedValue({
        ...ativo,
        tokenVersion: 4,
      });

      await expect(
        strategy.validate({ userId: 'u-3', tv: 4 }),
      ).resolves.toBeTruthy();
    });

    it('recusa token emitido antes da revogação das sessões', async () => {
      userRepository.findOneWithProfile.mockResolvedValue({
        ...ativo,
        tokenVersion: 5,
      });

      await expect(
        strategy.validate({ userId: 'u-3', tv: 4 }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('recusa token sem tv depois da primeira revogação', async () => {
      userRepository.findOneWithProfile.mockResolvedValue({
        ...ativo,
        tokenVersion: 1,
      });

      await expect(strategy.validate({ userId: 'u-3' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
