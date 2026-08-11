import { UsersService } from './users.service';
import { UserRole, UserStatus } from 'src/database/entities/user.entity';

/**
 * As listagens de equipe devolviam a entidade `User` inteira. `User` só tem
 * `@Exclude()` em senha e tokens de verificação, então CPF, CEP, endereço,
 * cidade, UF, gênero e data de nascimento de cada colega saíam junto — dado
 * pessoal de terceiro que nenhuma das duas telas exibe:
 *
 *  - `/colaboradores` mostra nome, e-mail, telefone e se é médico;
 *  - a lista de médicos alimenta seletores (nome, CRM, especialidade, status).
 *
 * Quem precisa do cadastro completo abre a tela de edição, que usa a rota por
 * id (`findCollaboratorById`) — essa continua devolvendo tudo.
 */
describe('UsersService — listagens de equipe não devolvem dado pessoal', () => {
  let service: UsersService;

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

  /** Como o TypeORM devolve de um `find` sem `select`: a linha inteira. */
  const linhaCompleta = (extra: Record<string, unknown> = {}) => ({
    id: 'colab-1',
    name: 'Maria Assistente',
    email: 'maria@email.com',
    phone: '11999998888',
    role: UserRole.COLLABORATOR,
    status: UserStatus.ACTIVE,
    ownerId: 'dono-1',
    adminId: 'dono-1',
    avatarUrl: null,
    permissions: [],
    isPlatformAdmin: false,
    cpf: '123.456.789-00',
    cep: '01234-567',
    address: 'Rua das Flores',
    addressNumber: '100',
    addressComplement: 'apto 12',
    city: 'São Paulo',
    state: 'SP',
    gender: 'F',
    birthDate: new Date('1990-05-02'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...extra,
  });

  const CAMPOS_PESSOAIS = [
    'cpf',
    'cep',
    'address',
    'addressNumber',
    'addressComplement',
    'city',
    'state',
    'gender',
    'birthDate',
  ];

  const semDadoPessoal = (payload: unknown) => {
    for (const campo of CAMPOS_PESSOAIS) {
      expect(payload).not.toHaveProperty(campo);
    }
    // Rede contra renomeação: o CPF não pode aparecer sob nenhum outro nome.
    expect(JSON.stringify(payload)).not.toContain('123.456.789-00');
  };

  beforeEach(() => {
    jest.clearAllMocks();
    userRepository.findOneWithProfile.mockResolvedValue(admin);
    doctorProfileRepository.findByUserId.mockResolvedValue(null);
    storageService.getSignedUrl.mockResolvedValue(null);

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

  describe('GET /users/collaborators', () => {
    it('não devolve CPF, endereço, gênero nem nascimento', async () => {
      userRepository.findByOwnerId.mockResolvedValue([
        linhaCompleta({ doctorProfile: null }),
      ]);

      const { records } = await service.findCollaborators('delegado-1');

      expect(records).toHaveLength(1);
      semDadoPessoal(records[0]);
    });

    it('mantém o que a tela usa, incluindo a permissão efetiva', async () => {
      userRepository.findByOwnerId.mockResolvedValue([
        linhaCompleta({ doctorProfile: { id: 'dp-1' } }),
      ]);

      const { records } = await service.findCollaborators('delegado-1');

      expect(records[0]).toMatchObject({
        id: 'colab-1',
        name: 'Maria Assistente',
        email: 'maria@email.com',
        phone: '11999998888',
        status: UserStatus.ACTIVE,
      });
      // Médico recebe as três áreas de trabalho por cima da coluna crua.
      expect(records[0].permissions).toEqual(
        expect.arrayContaining(['agenda', 'atendimento', 'solicitacoes']),
      );
      expect(records[0].doctorProfile).toBeTruthy();
    });
  });

  describe('GET /users/doctors', () => {
    it('não devolve CPF, endereço, gênero nem nascimento', async () => {
      userRepository.findDoctorsByOwnerId.mockResolvedValue([
        linhaCompleta({ id: 'medico-1', doctorProfile: { id: 'dp-1' } }),
      ]);

      const { records } = await service.findDoctors('dono-1');

      expect(records).toHaveLength(1);
      semDadoPessoal(records[0]);
    });

    /**
     * `findDoctors` fazia `...omitUserSecrets(d)`, que só tira senha e tokens
     * de verificação — a coluna crua `permissions` e o `isPlatformAdmin` iam
     * junto. Pela regra do projeto, a coluna crua só pode sair por
     * `findCollaboratorById` (a única rota gated por `ADMINISTRACAO` cuja tela
     * precisa dela para editar sem regravar o bônus de médico como concessão).
     */
    it('não devolve a coluna crua de permissões nem o flag de admin da plataforma', async () => {
      userRepository.findDoctorsByOwnerId.mockResolvedValue([
        linhaCompleta({
          id: 'medico-1',
          doctorProfile: { id: 'dp-1' },
          permissions: ['administracao'],
          isPlatformAdmin: true,
        }),
      ]);

      const { records } = await service.findDoctors('dono-1');

      expect(records[0]).not.toHaveProperty('permissions');
      expect(records[0]).not.toHaveProperty('isPlatformAdmin');
    });

    it('mantém id, nome, status e o perfil que alimenta os seletores', async () => {
      userRepository.findDoctorsByOwnerId.mockResolvedValue([
        linhaCompleta({
          id: 'medico-1',
          name: 'Dr. João',
          doctorProfile: {
            id: 'dp-1',
            crm: '123456',
            crmState: 'SP',
            specialty: 'Ortopedia',
          },
        }),
      ]);

      const { records } = await service.findDoctors('dono-1');

      expect(records[0]).toMatchObject({
        id: 'medico-1',
        name: 'Dr. João',
        status: UserStatus.ACTIVE,
        doctorProfile: {
          crm: '123456',
          crmState: 'SP',
          specialty: 'Ortopedia',
        },
      });
    });
  });
});
