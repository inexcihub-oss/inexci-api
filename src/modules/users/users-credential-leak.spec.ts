import { UsersService } from './users.service';
import { UserRole, UserStatus } from 'src/database/entities/user.entity';
import { omitUserSecrets } from 'src/shared/utils';

/**
 * D-14 — `POST /users/collaborators` devolvia o hash bcrypt da senha (e o
 * `emailVerificationToken`) no corpo do 201.
 *
 * Causa: o `ClassSerializerInterceptor` global só honra o `@Exclude()` da
 * entidade quando a resposta É uma instância de `User`. Todo service que faz
 * `{ ...user, campoExtra }` devolve um objeto literal — o interceptor passa
 * batido e a credencial vaza. Estes testes prendem o comportamento em cada
 * rota do `UsersController` que devolve dados de usuário.
 */
describe('UsersService — credenciais nunca saem na resposta', () => {
  let service: UsersService;

  const HASH = '$2b$12$tZmqCxRpm97leAlgUqYtmuHashFalsoParaTeste';

  const userRepository = {
    findOne: jest.fn(),
    findOneWithProfile: jest.fn(),
    findOneWithDeleted: jest.fn(),
    findByOwnerId: jest.fn(),
    findDoctorsByOwnerId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const mailService = { send: jest.fn().mockResolvedValue(undefined) };
  const userDoctorAccessRepository = {
    findAllByUserId: jest.fn().mockResolvedValue([]),
    upsert: jest.fn(),
  };
  const doctorProfileRepository = {
    findByUserId: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const recoveryCodeRepository = { deleteMany: jest.fn(), create: jest.fn() };
  const storageService = { getSignedUrl: jest.fn(), delete: jest.fn() };
  const whatsappService = { sendUserWelcome: jest.fn() };
  const configService = { get: jest.fn().mockReturnValue('http://localhost') };
  const doctorHeaderRepository = { findByDoctorProfileId: jest.fn() };
  const refreshTokenStore = { revokeAllForUser: jest.fn() };
  const eventEmitter = { emit: jest.fn() };

  const admin = {
    id: 'dono-1',
    name: 'Admin',
    role: UserRole.ADMIN,
    ownerId: 'dono-1',
  };

  /** Usuário como o TypeORM devolve de `save()`: com o hash recém-gravado. */
  const comCredenciais = (extra: Record<string, unknown> = {}) => ({
    id: 'novo-1',
    name: 'Novo',
    email: 'novo@email.com',
    phone: '11999998888',
    role: UserRole.COLLABORATOR,
    status: UserStatus.PENDING,
    ownerId: 'dono-1',
    adminId: 'dono-1',
    password: HASH,
    emailVerificationToken: 'token-de-verificacao',
    emailVerificationExpiresAt: new Date(),
    ...extra,
  });

  const semCredencial = (payload: unknown) => {
    expect(payload).not.toHaveProperty('password');
    expect(payload).not.toHaveProperty('emailVerificationToken');
    expect(payload).not.toHaveProperty('emailVerificationExpiresAt');
    // Rede de segurança contra renomeação de campo: o hash não pode aparecer
    // em canto nenhum do corpo, sob qualquer nome.
    expect(JSON.stringify(payload)).not.toContain(HASH);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    userRepository.findOneWithProfile.mockResolvedValue(admin);
    userRepository.findOne.mockResolvedValue(null);
    userRepository.findOneWithDeleted.mockResolvedValue(null);
    doctorProfileRepository.findByUserId.mockResolvedValue(null);
    mailService.send.mockResolvedValue(undefined);
    configService.get.mockReturnValue('http://localhost');
    userDoctorAccessRepository.findAllByUserId.mockResolvedValue([]);

    service = new UsersService(
      userRepository as any,
      mailService as any,
      userDoctorAccessRepository as any,
      doctorProfileRepository as any,
      recoveryCodeRepository as any,
      storageService as any,
      whatsappService as any,
      configService as any,
      doctorHeaderRepository as any,
      refreshTokenStore as any,
      eventEmitter as any,
    );
  });

  it('POST /users/collaborators — createCollaborator não devolve o hash da senha', async () => {
    userRepository.create.mockResolvedValue(comCredenciais());

    const resultado = await service.createCollaborator(
      { name: 'Novo', email: 'novo@email.com', phone: '11999998888' },
      'dono-1',
    );

    semCredencial(resultado);
    // O resto da resposta continua intacto.
    expect(resultado).toMatchObject({ id: 'novo-1', email: 'novo@email.com' });
  });

  it('POST /users — create não devolve o hash da senha', async () => {
    userRepository.create.mockResolvedValue(comCredenciais());

    const resultado = await service.create(
      { name: 'Novo', email: 'novo@email.com', phone: '11999998888' } as any,
      'dono-1',
    );

    semCredencial(resultado);
  });

  it('PATCH /users/collaborators/:id — updateCollaborator não devolve o hash da senha', async () => {
    userRepository.findOneWithProfile
      .mockResolvedValueOnce(admin)
      .mockResolvedValueOnce({
        id: 'novo-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        phone: '11999998888',
        permissions: [],
        doctorProfile: null,
      });
    userRepository.update.mockResolvedValue(
      comCredenciais({ name: 'Editado' }),
    );

    const resultado = await service.updateCollaborator(
      'novo-1',
      { name: 'Editado' },
      'dono-1',
    );

    semCredencial(resultado);
    expect(resultado).toMatchObject({ name: 'Editado' });
  });

  it('GET /users/collaborators — findCollaborators não devolve credenciais', async () => {
    userRepository.findByOwnerId.mockResolvedValue([
      comCredenciais({ id: 'novo-1', doctorProfile: null }),
    ]);

    const { records } = await service.findCollaborators('delegado-1');

    expect(records).toHaveLength(1);
    semCredencial(records[0]);
  });

  it('GET /users/collaborators/:id — findCollaboratorById não devolve credenciais', async () => {
    userRepository.findOneWithProfile
      .mockResolvedValueOnce(admin)
      .mockResolvedValueOnce(
        comCredenciais({ id: 'novo-1', doctorProfile: null, permissions: [] }),
      );

    const resultado = await service.findCollaboratorById('novo-1', 'dono-1');

    semCredencial(resultado);
  });

  it('GET /users/doctors — findDoctors não devolve credenciais', async () => {
    userRepository.findDoctorsByOwnerId.mockResolvedValue([
      comCredenciais({ id: 'medico-1', doctorProfile: { id: 'dp-1' } }),
    ]);

    const { records } = await service.findDoctors('dono-1');

    expect(records).toHaveLength(1);
    semCredencial(records[0]);
  });

  it('GET /users/profile — getProfile não devolve credenciais', async () => {
    userRepository.findOneWithProfile.mockResolvedValue(
      comCredenciais({ id: 'dono-1', doctorProfile: null, permissions: [] }),
    );

    const resultado = await service.getProfile('dono-1');

    semCredencial(resultado);
  });
});

describe('omitUserSecrets', () => {
  it('remove os três campos de credencial e preserva o resto', () => {
    const resultado = omitUserSecrets({
      id: 'u1',
      email: 'a@b.com',
      password: '$2b$12$hash',
      emailVerificationToken: 'tok',
      emailVerificationExpiresAt: new Date(),
    });

    expect(resultado).toEqual({ id: 'u1', email: 'a@b.com' });
  });

  it('não altera o objeto original', () => {
    const original = { id: 'u1', password: '$2b$12$hash' };
    omitUserSecrets(original);
    expect(original.password).toBe('$2b$12$hash');
  });
});
