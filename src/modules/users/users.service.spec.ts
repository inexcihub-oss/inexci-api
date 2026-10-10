import { ProfessionalCouncil } from 'src/database/entities/doctor-profile.entity';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UserRole, UserStatus } from 'src/database/entities/user.entity';
import { UserDoctorAccessStatus } from 'src/database/entities/user-doctor-access.entity';
import { Permission } from 'src/shared/permissions';

describe('UsersService — Colaboradores e Permissões', () => {
  let service: UsersService;

  const mockUserRepository = {
    findOne: jest.fn(),
    findOneWithProfile: jest.fn(),
    findOneWithDeleted: jest.fn(),
    findByOwnerId: jest.fn(),
    findDoctorsByOwnerId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    total: jest.fn(),
    findMany: jest.fn(),
    findCollaboratorsByIds: jest.fn(),
    bulkSoftDelete: jest.fn(),
    getRepository: jest.fn(),
  };
  const mockMailService = {
    send: jest.fn().mockResolvedValue(undefined),
  };
  const mockUserDoctorAccessRepository = {
    findActiveByUserId: jest.fn(),
    findActiveByDoctorUserId: jest.fn(),
    findAllByUserId: jest.fn(),
    findByOwnerId: jest.fn(),
    upsert: jest.fn(),
    deactivate: jest.fn(),
  };
  const mockDoctorProfileRepository = {
    findOne: jest.fn(),
    findByUserId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    existsByUserId: jest.fn(),
  };
  const mockStorageService = {
    uploadFile: jest.fn(),
    getSignedUrl: jest.fn(),
    delete: jest.fn(),
  };
  const mockWhatsappService = {
    sendUserWelcome: jest.fn(),
    sendPatientWelcome: jest.fn(),
  };
  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'DASHBOARD_URL') return 'http://localhost:3000';
      return undefined;
    }),
  };
  const mockRecoveryCodeRepository = {
    deleteMany: jest.fn(),
    create: jest.fn(),
  };
  const mockDoctorHeaderRepository = {
    findByDoctorProfileId: jest.fn(),
    upsert: jest.fn(),
    removeByDoctorProfileId: jest.fn(),
  };
  const mockRefreshTokenStore = {
    revokeAllForUser: jest.fn(),
  };
  const mockEventEmitter = { emit: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    mockMailService.send.mockResolvedValue(undefined);
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'DASHBOARD_URL') return 'http://localhost:3000';
      return undefined;
    });

    service = new UsersService(
      mockUserRepository as any,
      mockMailService as any,
      mockUserDoctorAccessRepository as any,
      mockDoctorProfileRepository as any,
      mockRecoveryCodeRepository as any,
      mockStorageService as any,
      mockWhatsappService as any,
      mockConfigService as any,
      mockDoctorHeaderRepository as any,
      mockRefreshTokenStore as any,
      mockEventEmitter as any,
    );
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('findCollaborators', () => {
    it('deve retornar lista de colaboradores da conta', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'dono-1',
        role: UserRole.ADMIN,
        ownerId: 'dono-1',
      });
      mockUserRepository.findByOwnerId.mockResolvedValue([
        { id: 'collab-1', name: 'Colaborador 1' },
      ]);

      const result = await service.findCollaborators('dono-1');

      expect(result.records).toHaveLength(1);
      expect(mockUserRepository.findByOwnerId).toHaveBeenCalledWith(
        'dono-1',
        0,
        50,
      );
    });

    it('deve lançar NotFoundException se admin não encontrado', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue(null);

      await expect(service.findCollaborators('invalid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve lançar ForbiddenException se não é admin', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'user-1',
        role: UserRole.COLLABORATOR,
        permissions: [],
        doctorProfile: null,
      });

      await expect(service.findCollaborators('user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('não deve listar o dono da conta para um admin delegado', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'delegado-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });
      mockUserRepository.findByOwnerId.mockResolvedValue([
        { id: 'dono-1', name: 'Dono da Conta' },
        { id: 'collab-1', name: 'Colaborador 1' },
      ]);

      const result = await service.findCollaborators('delegado-1');

      expect(result.records).toHaveLength(1);
      expect(
        result.records.find((r: any) => r.id === 'dono-1'),
      ).toBeUndefined();
    });

    it('não deve expor permissions cru nem isPlatformAdmin de nenhum colaborador da lista', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'dono-1',
        role: UserRole.ADMIN,
        ownerId: 'dono-1',
      });
      mockUserRepository.findByOwnerId.mockResolvedValue([
        {
          id: 'collab-1',
          name: 'Colaborador 1',
          role: UserRole.COLLABORATOR,
          permissions: [],
          isPlatformAdmin: true,
          doctorProfile: { id: 'dp-1', council: 'CRM' },
        },
      ]);

      const result = await service.findCollaborators('dono-1');

      expect(result.records).toHaveLength(1);
      expect(result.records[0]).not.toHaveProperty('isPlatformAdmin');
      expect(result.records[0].permissions).toEqual([
        Permission.AGENDA,
        Permission.ATENDIMENTO,
        Permission.SOLICITACOES,
      ]);
    });
  });

  describe('getProfile', () => {
    it('expõe a permissão efetiva, mas não permissions cru, isPlatformAdmin nem password', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'user-1',
        role: UserRole.COLLABORATOR,
        password: 'hash-secreto',
        permissions: [],
        isPlatformAdmin: true,
        doctorProfile: { id: 'dp-1', council: 'CRM' },
      });

      const result = await service.getProfile('user-1');

      expect(result.permissions).toEqual([
        Permission.AGENDA,
        Permission.ATENDIMENTO,
        Permission.SOLICITACOES,
      ]);
      expect(result).not.toHaveProperty('isPlatformAdmin');
      expect(result).not.toHaveProperty('password');
    });

    it('não expõe onboardingState cru (nem null)', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'user-1',
        role: UserRole.COLLABORATOR,
        permissions: [],
        isPlatformAdmin: false,
        doctorProfile: null,
        onboardingState: null,
      });

      const result = await service.getProfile('user-1');

      expect(result).not.toHaveProperty('onboardingState');
    });
  });

  describe('findCollaboratorById', () => {
    it('expõe a permissão efetiva do colaborador ao admin, sem permissions cru, isPlatformAdmin ou password', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'dono-1',
          role: UserRole.ADMIN,
          ownerId: 'dono-1',
        })
        .mockResolvedValueOnce({
          id: 'collab-1',
          role: UserRole.COLLABORATOR,
          ownerId: 'dono-1',
          password: 'hash-secreto',
          permissions: [],
          isPlatformAdmin: false,
          doctorProfile: { id: 'dp-1', council: 'CRM' },
        });
      mockUserDoctorAccessRepository.findAllByUserId.mockResolvedValue([]);

      const result = await service.findCollaboratorById('collab-1', 'dono-1');

      expect(result.permissions).toEqual([
        Permission.AGENDA,
        Permission.ATENDIMENTO,
        Permission.SOLICITACOES,
      ]);
      expect(result).not.toHaveProperty('isPlatformAdmin');
      expect(result).not.toHaveProperty('password');
      expect(result.grantedPermissions).toEqual([]);
    });

    it('não expõe onboardingState cru do colaborador (nem null)', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'dono-1',
          role: UserRole.ADMIN,
          ownerId: 'dono-1',
        })
        .mockResolvedValueOnce({
          id: 'collab-1',
          role: UserRole.COLLABORATOR,
          ownerId: 'dono-1',
          permissions: [],
          isPlatformAdmin: false,
          doctorProfile: null,
          onboardingState: null,
        });
      mockUserDoctorAccessRepository.findAllByUserId.mockResolvedValue([]);

      const result = await service.findCollaboratorById('collab-1', 'dono-1');

      expect(result).not.toHaveProperty('onboardingState');
    });

    it('permite que o dono veja colaborador criado por um admin delegado', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'dono-1',
          role: UserRole.ADMIN,
          ownerId: 'dono-1',
        })
        .mockResolvedValueOnce({
          id: 'collab-do-delegado',
          ownerId: 'dono-1',
          adminId: 'delegado-1',
          doctorProfile: null,
        });
      mockUserDoctorAccessRepository.findAllByUserId.mockResolvedValue([]);

      await expect(
        service.findCollaboratorById('collab-do-delegado', 'dono-1'),
      ).resolves.toBeDefined();
    });
  });

  describe('createCollaborator', () => {
    const adminUser = {
      id: 'dono-1',
      name: 'Admin',
      role: UserRole.ADMIN,
      ownerId: 'dono-1',
    };

    beforeEach(() => {
      mockUserRepository.findOneWithProfile.mockResolvedValue(adminUser);
      mockUserRepository.findOne.mockResolvedValue(null);
      mockUserRepository.findOneWithDeleted.mockResolvedValue(null);
      mockDoctorProfileRepository.findByUserId.mockResolvedValue(null);
    });

    it('deve criar colaborador com role COLLABORATOR e status PENDING', async () => {
      mockUserRepository.create.mockResolvedValue({
        id: 'new-1',
        name: 'Novo',
        email: 'novo@email.com',
        role: UserRole.COLLABORATOR,
        status: UserStatus.PENDING,
        ownerId: 'dono-1',
        adminId: 'dono-1',
      });

      await service.createCollaborator(
        { name: 'Novo', email: 'novo@email.com', phone: '11999998888' },
        'dono-1',
      );

      expect(mockUserRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: UserRole.COLLABORATOR,
          status: UserStatus.PENDING,
          ownerId: 'dono-1',
          adminId: 'dono-1',
        }),
      );
    });

    it('deve lançar BadRequestException para email duplicado', async () => {
      mockUserRepository.findOneWithDeleted.mockResolvedValue({
        id: 'existing',
        deletedAt: null,
        email: 'existente@email.com',
      });

      await expect(
        service.createCollaborator(
          { name: 'Dup', email: 'existente@email.com', phone: '11999997777' },
          'dono-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve enviar email de boas-vindas ao colaborador', async () => {
      mockUserRepository.create.mockResolvedValue({
        id: 'new-1',
        name: 'Novo',
        email: 'novo@email.com',
        role: UserRole.COLLABORATOR,
      });

      await service.createCollaborator(
        { name: 'Novo', email: 'novo@email.com', phone: '11999998888' },
        'dono-1',
      );

      expect(mockUserRepository.create).toHaveBeenCalled();
    });

    it('deve criar doctorProfile e enviar WhatsApp se colaborador é médico com telefone', async () => {
      mockUserRepository.create.mockResolvedValue({
        id: 'new-1',
        name: 'Dr. João',
        email: 'joao@email.com',
        phone: '+5511999999999',
        role: UserRole.COLLABORATOR,
      });

      await service.createCollaborator(
        {
          name: 'Dr. João',
          email: 'joao@email.com',
          phone: '+5511999999999',
          isDoctor: true,
          crm: '123',
          crmState: 'SP',
        },
        'dono-1',
      );

      expect(mockDoctorProfileRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'new-1',
          crm: '123',
          crmState: 'SP',
        }),
      );

      expect(mockWhatsappService.sendUserWelcome).toHaveBeenCalledWith(
        '+5511999999999',
        'Dr. João',
      );
    });

    it('deve criar doctorProfile quando CRM/UF são enviados sem isDoctor', async () => {
      mockUserRepository.create.mockResolvedValue({
        id: 'new-3',
        name: 'Dra. Maria',
        email: 'maria@email.com',
        phone: '+5511977777777',
        role: UserRole.COLLABORATOR,
      });

      await service.createCollaborator(
        {
          name: 'Dra. Maria',
          email: 'maria@email.com',
          phone: '+5511977777777',
          crm: '987654',
          crmState: 'GO',
          specialty: 'Ortopedia',
        },
        'dono-1',
      );

      expect(mockDoctorProfileRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'new-3',
          crm: '987654',
          crmState: 'GO',
          specialty: 'Ortopedia',
        }),
      );
    });

    it('deve enviar WhatsApp para colaborador não-médico com telefone', async () => {
      mockUserRepository.create.mockResolvedValue({
        id: 'new-2',
        name: 'Ana',
        email: 'ana@email.com',
        phone: '+5511988888888',
        role: UserRole.COLLABORATOR,
      });

      mockWhatsappService.sendUserWelcome.mockClear();

      await service.createCollaborator(
        {
          name: 'Ana',
          email: 'ana@email.com',
          phone: '+5511988888888',
        },
        'dono-1',
      );

      expect(mockWhatsappService.sendUserWelcome).toHaveBeenCalledWith(
        '+5511988888888',
        'Ana',
      );
    });

    it('deve vincular o colaborador ao admin criador quando o admin é médico', async () => {
      mockDoctorProfileRepository.findByUserId.mockResolvedValue({
        id: 'dp-admin',
        userId: 'dono-1',
      });

      mockUserRepository.create.mockResolvedValue({
        id: 'new-1',
        name: 'Novo',
        email: 'novo@email.com',
        role: UserRole.COLLABORATOR,
      });

      await service.createCollaborator(
        { name: 'Novo', email: 'novo@email.com', phone: '11999998888' },
        'dono-1',
      );

      expect(mockUserDoctorAccessRepository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'new-1',
          doctorUserId: 'dono-1',
          status: UserDoctorAccessStatus.ACTIVE,
          createdById: 'dono-1',
        }),
      );
    });

    it('não deve criar vínculo quando o admin criador não é médico', async () => {
      mockDoctorProfileRepository.findByUserId.mockResolvedValue(null);

      mockUserRepository.create.mockResolvedValue({
        id: 'new-1',
        name: 'Novo',
        email: 'novo@email.com',
        role: UserRole.COLLABORATOR,
      });

      await service.createCollaborator(
        { name: 'Novo', email: 'novo@email.com', phone: '11999998888' },
        'dono-1',
      );

      expect(mockUserDoctorAccessRepository.upsert).not.toHaveBeenCalled();
    });

    it('não deve expor permissions cru nem isPlatformAdmin no colaborador recém-criado, e reflete o isDoctor recém-criado na permissão efetiva', async () => {
      mockUserRepository.create.mockResolvedValue({
        id: 'new-doc-1',
        name: 'Dr. João',
        email: 'joao@email.com',
        phone: '+5511999999999',
        role: UserRole.COLLABORATOR,
        permissions: [Permission.SOLICITACOES],
        isPlatformAdmin: false,
      });

      const result = await service.createCollaborator(
        {
          name: 'Dr. João',
          email: 'joao@email.com',
          phone: '+5511999999999',
          isDoctor: true,
          crm: '123',
          crmState: 'SP',
          permissions: [Permission.SOLICITACOES],
        } as never,
        'dono-1',
      );

      expect(result).not.toHaveProperty('isPlatformAdmin');
      expect(result.permissions).toEqual([
        Permission.AGENDA,
        Permission.ATENDIMENTO,
        Permission.SOLICITACOES,
      ]);
    });

    it('devolve permissions vazio para colaborador não-médico sem permissões informadas', async () => {
      mockUserRepository.create.mockResolvedValue({
        id: 'new-x',
        name: 'Ana',
        email: 'ana@email.com',
        role: UserRole.COLLABORATOR,
        permissions: [],
        isPlatformAdmin: false,
      });

      const result = await service.createCollaborator(
        { name: 'Ana', email: 'ana@email.com', phone: '11999998888' },
        'dono-1',
      );

      expect(result.permissions).toEqual([]);
    });
  });

  describe('createCollaborator — admin delegado', () => {
    it('deixa colaborador com administração criar outro colaborador', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'delegado-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });
      mockUserRepository.findOne.mockResolvedValue(null);
      mockUserRepository.findOneWithDeleted.mockResolvedValue(null);
      mockUserRepository.create.mockResolvedValue({ id: 'novo-1' });

      await expect(
        service.createCollaborator(
          { name: 'Ana', email: 'ana@x.com', phone: '11999999999' } as never,
          'delegado-1',
        ),
      ).resolves.toBeDefined();

      expect(mockUserRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: 'dono-1', adminId: 'delegado-1' }),
      );
    });

    it('bloqueia colaborador sem administração', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'comum-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.AGENDA],
        doctorProfile: null,
      });

      await expect(
        service.createCollaborator(
          { name: 'Ana', email: 'ana@x.com', phone: '11999999999' } as never,
          'comum-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('create — segurança contra escalonamento de role (C1)', () => {
    it('ignora role="admin" no payload e sempre cria como collaborator', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'delegado-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        name: 'Delegado',
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });
      mockUserRepository.findOne.mockResolvedValue(null);
      mockUserRepository.create.mockResolvedValue({
        id: 'novo-1',
        email: 'invasor@x.com',
        name: 'Invasor',
      });

      await service.create(
        {
          name: 'Invasor',
          email: 'invasor@x.com',
          phone: '11988887777',
          role: UserRole.ADMIN,
        } as never,
        'delegado-1',
      );

      expect(mockUserRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: UserRole.COLLABORATOR,
          ownerId: 'dono-1',
          adminId: 'delegado-1',
        }),
      );
      expect(mockUserRepository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.ADMIN }),
      );
    });

    it('bloqueia quem não tem Administração', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'comum-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.AGENDA],
        doctorProfile: null,
      });

      await expect(
        service.create(
          { name: 'X', email: 'x@x.com', phone: '11999999999' } as never,
          'comum-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateProfile — avatar e assinatura (caminho do bucket)', () => {
    const FOTO_PACIENTE = 'patient-photos/dono-1/uuid-foto.webp';
    const usuario = (parcial: Record<string, unknown> = {}) => ({
      id: 'user-1',
      ownerId: 'dono-1',
      avatarUrl: 'avatars/dono-1/antigo.png',
      ...parcial,
    });

    beforeEach(() => {
      mockUserRepository.update.mockResolvedValue({ id: 'user-1' });
      mockStorageService.delete.mockResolvedValue(undefined);
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'user-1',
        ownerId: 'dono-1',
        role: UserRole.ADMIN,
        permissions: [],
        doctorProfile: null,
      });
    });

    it('devolve o mesmo formato do GET /users/profile, relido depois das gravações', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce(usuario());
      mockDoctorProfileRepository.findByUserId.mockResolvedValue({
        id: 'dp-1',
        signatureUrl: null,
      });
      mockDoctorProfileRepository.findOne.mockResolvedValue(null);
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'user-1',
        ownerId: 'dono-1',
        role: UserRole.ADMIN,
        permissions: [],
        password: 'hash',
        doctorProfile: {
          id: 'dp-1',
          council: ProfessionalCouncil.CRM,
          signatureUrl: 'https://assinada/nova.png',
        },
      });

      const resposta = await service.updateProfile(
        { name: 'Novo', signatureUrl: 'signatures/dono-1/nova.png' },
        'user-1',
      );

      const ordemGravacao =
        mockDoctorProfileRepository.update.mock.invocationCallOrder[0];
      const ordemLeitura =
        mockUserRepository.findOneWithProfile.mock.invocationCallOrder.at(-1)!;
      expect(ordemLeitura).toBeGreaterThan(ordemGravacao);

      expect(resposta).toEqual(await service.getProfile('user-1'));
      expect(resposta).toMatchObject({
        isDoctor: true,
        isPhysician: true,
        doctorProfile: { signatureUrl: 'https://assinada/nova.png' },
      });
      expect(resposta.permissions).toEqual(
        expect.arrayContaining([
          Permission.AGENDA,
          Permission.ATENDIMENTO,
          Permission.SOLICITACOES,
          Permission.ADMINISTRACAO,
        ]),
      );
      expect(resposta).not.toHaveProperty('password');
    });

    it('avatar da pasta da conta: grava e apaga o antigo', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce(usuario())
        .mockResolvedValueOnce(null);

      await service.updateProfile(
        { avatarUrl: 'avatars/dono-1/novo.png' },
        'user-1',
      );

      expect(mockUserRepository.update).toHaveBeenCalledWith('user-1', {
        avatarUrl: 'avatars/dono-1/novo.png',
      });
      expect(mockStorageService.delete).toHaveBeenCalledWith(
        'avatars/dono-1/antigo.png',
      );
    });

    it.each([
      ['foto de paciente', FOTO_PACIENTE],
      ['avatar de outra conta', 'avatars/outro-dono/a.png'],
      ['documento', 'documents/dono-1/laudo.pdf'],
      ['travessia', `avatars/dono-1/../../${FOTO_PACIENTE}`],
    ])(
      'recusa avatar apontando para %s, sem gravar nem apagar',
      async (_rotulo, avatarUrl) => {
        mockUserRepository.findOne.mockResolvedValueOnce(usuario());

        await expect(
          service.updateProfile({ avatarUrl }, 'user-1'),
        ).rejects.toThrow(BadRequestException);
        expect(mockUserRepository.update).not.toHaveBeenCalled();
        expect(mockStorageService.delete).not.toHaveBeenCalled();
      },
    );

    it('avatar antigo fora da pasta de avatares da conta não é apagado', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce(
        usuario({ avatarUrl: FOTO_PACIENTE }),
      );

      await service.updateProfile({ avatarUrl: null }, 'user-1');

      expect(mockUserRepository.update).toHaveBeenCalledWith('user-1', {
        avatarUrl: null,
      });
      expect(mockStorageService.delete).not.toHaveBeenCalled();
    });

    it('avatar antigo usado por outro usuário da conta não é apagado', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce(usuario())
        .mockResolvedValueOnce({ id: 'colega-1' });

      await service.updateProfile(
        { avatarUrl: 'avatars/dono-1/novo.png' },
        'user-1',
      );

      expect(mockStorageService.delete).not.toHaveBeenCalled();
    });

    it('reenviar o avatar atual (mesmo legado, fora da pasta da conta) não apaga nem recusa', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce(
        usuario({ avatarUrl: 'avatars/legado.png' }),
      );

      await service.updateProfile(
        { avatarUrl: 'avatars/legado.png' },
        'user-1',
      );

      expect(mockUserRepository.update).toHaveBeenCalledWith('user-1', {
        avatarUrl: 'avatars/legado.png',
      });
      expect(mockStorageService.delete).not.toHaveBeenCalled();
    });

    it('assinatura: recusa caminho de outra conta antes de gravar o perfil', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce(usuario());
      mockDoctorProfileRepository.findByUserId.mockResolvedValue({
        id: 'dp-1',
        signatureUrl: 'signatures/dono-1/antiga.png',
      });

      await expect(
        service.updateProfile(
          { name: 'X', signatureUrl: 'signatures/outro-dono/a.png' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockUserRepository.update).not.toHaveBeenCalled();
      expect(mockDoctorProfileRepository.update).not.toHaveBeenCalled();
      expect(mockStorageService.delete).not.toHaveBeenCalled();
    });

    it('assinatura da conta: grava e apaga a antiga da pasta da conta', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce(usuario());
      mockDoctorProfileRepository.findByUserId.mockResolvedValue({
        id: 'dp-1',
        signatureUrl: 'signatures/dono-1/antiga.png',
      });
      mockDoctorProfileRepository.findOne.mockResolvedValue(null);

      await service.updateProfile(
        { signatureUrl: 'signatures/dono-1/nova.png' },
        'user-1',
      );

      expect(mockDoctorProfileRepository.update).toHaveBeenCalledWith('dp-1', {
        signatureUrl: 'signatures/dono-1/nova.png',
      });
      expect(mockStorageService.delete).toHaveBeenCalledWith(
        'signatures/dono-1/antiga.png',
      );
    });

    it('assinatura antiga fora da pasta da conta não é apagada', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce(usuario());
      mockDoctorProfileRepository.findByUserId.mockResolvedValue({
        id: 'dp-1',
        signatureUrl: FOTO_PACIENTE,
      });
      mockDoctorProfileRepository.findOne.mockResolvedValue(null);

      await service.updateProfile({ signatureUrl: null }, 'user-1');

      expect(mockDoctorProfileRepository.update).toHaveBeenCalledWith('dp-1', {
        signatureUrl: null,
      });
      expect(mockStorageService.delete).not.toHaveBeenCalled();
    });
  });

  describe('updateProfileById — avatar', () => {
    it('admin delegado não grava como avatar do colaborador a foto de um paciente', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'delegado-1', ownerId: 'dono-1' })
        .mockResolvedValueOnce({
          id: 'collab-1',
          ownerId: 'dono-1',
          avatarUrl: null,
        });
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'delegado-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });

      await expect(
        service.updateProfileById(
          'collab-1',
          { avatarUrl: 'patient-photos/dono-1/uuid-foto.webp' },
          'delegado-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });

    it('aceita avatar da pasta da conta do alvo', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'user-1', ownerId: 'dono-1' })
        .mockResolvedValueOnce({ id: 'user-1', ownerId: 'dono-1' });
      mockUserRepository.update.mockResolvedValue({ id: 'user-1' });

      await service.updateProfileById(
        'user-1',
        { avatarUrl: 'avatars/dono-1/novo.png' },
        'user-1',
      );

      expect(mockUserRepository.update).toHaveBeenCalledWith('user-1', {
        avatarUrl: 'avatars/dono-1/novo.png',
      });
    });
  });

  describe('updateProfileById', () => {
    it('permite que o usuário edite o próprio perfil sem checar Administração', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'user-1', ownerId: 'dono-1' })
        .mockResolvedValueOnce({ id: 'user-1', ownerId: 'dono-1' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockUserRepository.update.mockResolvedValue({ id: 'user-1' });

      await expect(
        service.updateProfileById(
          'user-1',
          { name: 'Novo nome' } as never,
          'user-1',
        ),
      ).resolves.toBeDefined();
      expect(mockUserRepository.findOneWithProfile).not.toHaveBeenCalled();
    });

    it('deixa admin delegado editar colaborador do mesmo tenant', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'delegado-1', ownerId: 'dono-1' })
        .mockResolvedValueOnce({ id: 'collab-1', ownerId: 'dono-1' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'delegado-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });
      mockUserRepository.update.mockResolvedValue({ id: 'collab-1' });

      await expect(
        service.updateProfileById(
          'collab-1',
          { name: 'Novo nome' } as never,
          'delegado-1',
        ),
      ).resolves.toBeDefined();
    });

    it('bloqueia edição de usuário de outro tenant mesmo com Administração', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'delegado-1', ownerId: 'dono-1' })
        .mockResolvedValueOnce({
          id: 'user-de-outra-conta',
          ownerId: 'outro-dono',
        });
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'delegado-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });

      await expect(
        service.updateProfileById(
          'user-de-outra-conta',
          { name: 'Sequestro' } as never,
          'delegado-1',
        ),
      ).rejects.toThrow('Este usuário não pertence à sua conta');
    });

    it('bloqueia edição do dono da conta por um admin delegado', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'delegado-1', ownerId: 'dono-1' })
        .mockResolvedValueOnce({ id: 'dono-1', ownerId: 'dono-1' });
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'delegado-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });

      await expect(
        service.updateProfileById(
          'dono-1',
          { phone: '11900000000' } as never,
          'delegado-1',
        ),
      ).rejects.toThrow(
        'O dono da conta não pode ser alterado por outro usuário.',
      );
    });

    it('bloqueia colaborador sem Administração de editar outro usuário', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'comum-1', ownerId: 'dono-1' })
        .mockResolvedValueOnce({ id: 'collab-1', ownerId: 'dono-1' });
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'comum-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.AGENDA],
        doctorProfile: null,
      });

      await expect(
        service.updateProfileById(
          'collab-1',
          { name: 'X' } as never,
          'comum-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateProfileById — gênero em coluna char(1)', () => {
    function prepararSelfEdit() {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'user-1', ownerId: 'dono-1' })
        .mockResolvedValueOnce({ id: 'user-1', ownerId: 'dono-1' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockUserRepository.update.mockResolvedValue({ id: 'user-1' });
    }

    it('grava null quando o gênero vem vazio', async () => {
      prepararSelfEdit();
      await service.updateProfileById(
        'user-1',
        { gender: '' } as never,
        'user-1',
      );
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ gender: null }),
      );
    });

    it('grava null quando o gênero vem só com espaço (valor já preenchido pelo char)', async () => {
      prepararSelfEdit();
      await service.updateProfileById(
        'user-1',
        { gender: ' ' } as never,
        'user-1',
      );
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ gender: null }),
      );
    });

    it('preserva um gênero de verdade', async () => {
      prepararSelfEdit();
      await service.updateProfileById(
        'user-1',
        { gender: 'F' } as never,
        'user-1',
      );
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ gender: 'F' }),
      );
    });

    it('não toca no campo quando ele não é enviado', async () => {
      prepararSelfEdit();
      await service.updateProfileById(
        'user-1',
        { name: 'Outro nome' } as never,
        'user-1',
      );
      const [, updates] = mockUserRepository.update.mock.calls.at(-1) as [
        string,
        Record<string, unknown>,
      ];
      expect(updates).not.toHaveProperty('gender');
    });
  });

  describe('updateCollaborator', () => {
    it('deve lançar ForbiddenException se não é admin', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'user-1',
        role: UserRole.COLLABORATOR,
        permissions: [],
        doctorProfile: null,
      });

      await expect(
        service.updateCollaborator('collab-1', { name: 'Novo' }, 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar ForbiddenException se colaborador pertence a outro tenant', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'dono-1',
          role: UserRole.ADMIN,
          ownerId: 'dono-1',
        })
        .mockResolvedValueOnce({ id: 'collab-1', ownerId: 'outro-dono' });

      await expect(
        service.updateCollaborator('collab-1', { name: 'Novo' }, 'dono-1'),
      ).rejects.toThrow('Este colaborador não pertence à sua conta');
    });

    it('deve lançar ForbiddenException se o alvo é o dono da conta', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'delegado-1',
          role: UserRole.COLLABORATOR,
          ownerId: 'dono-1',
          permissions: [Permission.ADMINISTRACAO],
          doctorProfile: null,
        })
        .mockResolvedValueOnce({
          id: 'dono-1',
          ownerId: 'dono-1',
          adminId: 'delegado-1',
        });

      await expect(
        service.updateCollaborator('dono-1', { name: 'Novo' }, 'delegado-1'),
      ).rejects.toThrow(
        'O dono da conta não pode ser alterado por outro usuário.',
      );
    });

    it('permite que o dono edite colaborador criado por um admin delegado', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'dono-1',
          role: UserRole.ADMIN,
          ownerId: 'dono-1',
        })
        .mockResolvedValueOnce({
          id: 'collab-do-delegado',
          ownerId: 'dono-1',
          adminId: 'delegado-1',
          doctorProfile: null,
        });
      mockUserRepository.update.mockResolvedValue({ id: 'collab-do-delegado' });

      await expect(
        service.updateCollaborator(
          'collab-do-delegado',
          { name: 'Editado pelo dono' },
          'dono-1',
        ),
      ).resolves.toBeDefined();
    });

    it('permite que o admin delegado edite colaborador criado pelo dono', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'delegado-1',
          role: UserRole.COLLABORATOR,
          ownerId: 'dono-1',
          permissions: [Permission.ADMINISTRACAO],
          doctorProfile: null,
        })
        .mockResolvedValueOnce({
          id: 'collab-do-dono',
          ownerId: 'dono-1',
          adminId: 'dono-1',
          doctorProfile: null,
        });
      mockUserRepository.update.mockResolvedValue({ id: 'collab-do-dono' });

      await expect(
        service.updateCollaborator(
          'collab-do-dono',
          { name: 'Editado pelo delegado' },
          'delegado-1',
        ),
      ).resolves.toBeDefined();
    });

    it('deve remover doctorProfile ao desmarcar isDoctor', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'dono-1',
          role: UserRole.ADMIN,
          ownerId: 'dono-1',
        })
        .mockResolvedValueOnce({
          id: 'collab-1',
          ownerId: 'dono-1',
          adminId: 'dono-1',
          doctorProfile: {
            id: 'dp-1',
            crm: '123',
            crmState: 'SP',
            specialty: 'Ortopedia',
          },
        });

      mockUserRepository.update.mockResolvedValue({
        id: 'collab-1',
      });

      await service.updateCollaborator(
        'collab-1',
        { isDoctor: false },
        'dono-1',
      );

      expect(mockDoctorProfileRepository.delete).toHaveBeenCalledWith('dp-1');
    });

    it('não altera permissions quando o campo é omitido', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'dono-1',
          role: UserRole.ADMIN,
          ownerId: 'dono-1',
        })
        .mockResolvedValueOnce({
          id: 'collab-1',
          ownerId: 'dono-1',
          adminId: 'dono-1',
          doctorProfile: null,
        });
      mockUserRepository.update.mockResolvedValue({ id: 'collab-1' });

      await service.updateCollaborator('collab-1', { name: 'Novo' }, 'dono-1');

      const [, updates] = mockUserRepository.update.mock.calls[0];
      expect(updates).not.toHaveProperty('permissions');
    });

    it('grava array vazio quando todas as permissões são retiradas', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'dono-1',
          role: UserRole.ADMIN,
          ownerId: 'dono-1',
        })
        .mockResolvedValueOnce({
          id: 'collab-1',
          ownerId: 'dono-1',
          adminId: 'dono-1',
          doctorProfile: null,
        });
      mockUserRepository.update.mockResolvedValue({ id: 'collab-1' });

      await service.updateCollaborator(
        'collab-1',
        { permissions: [] } as never,
        'dono-1',
      );

      expect(mockUserRepository.update).toHaveBeenCalledWith(
        'collab-1',
        expect.objectContaining({ permissions: [] }),
      );
    });

    it('grava as permissões informadas', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'dono-1',
          role: UserRole.ADMIN,
          ownerId: 'dono-1',
        })
        .mockResolvedValueOnce({
          id: 'collab-1',
          ownerId: 'dono-1',
          adminId: 'dono-1',
          doctorProfile: null,
        });
      mockUserRepository.update.mockResolvedValue({ id: 'collab-1' });

      await service.updateCollaborator(
        'collab-1',
        { permissions: [Permission.SOLICITACOES] } as never,
        'dono-1',
      );

      expect(mockUserRepository.update).toHaveBeenCalledWith(
        'collab-1',
        expect.objectContaining({ permissions: [Permission.SOLICITACOES] }),
      );
    });

    it('devolve a permissão efetiva após conceder permissões', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'dono-1',
          role: UserRole.ADMIN,
          ownerId: 'dono-1',
        })
        .mockResolvedValueOnce({
          id: 'collab-1',
          role: UserRole.COLLABORATOR,
          ownerId: 'dono-1',
          adminId: 'dono-1',
          permissions: [],
          doctorProfile: null,
        });
      mockUserRepository.update.mockResolvedValue({
        id: 'collab-1',
        role: UserRole.COLLABORATOR,
      });

      const result = await service.updateCollaborator(
        'collab-1',
        { permissions: [Permission.SOLICITACOES] } as never,
        'dono-1',
      );

      expect(result.permissions).toEqual([Permission.SOLICITACOES]);
    });

    it('devolve a permissão efetiva já existente quando permissions é omitido', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'dono-1',
          role: UserRole.ADMIN,
          ownerId: 'dono-1',
        })
        .mockResolvedValueOnce({
          id: 'collab-1',
          role: UserRole.COLLABORATOR,
          ownerId: 'dono-1',
          adminId: 'dono-1',
          permissions: [Permission.AGENDA],
          doctorProfile: null,
        });
      mockUserRepository.update.mockResolvedValue({
        id: 'collab-1',
        role: UserRole.COLLABORATOR,
      });

      const result = await service.updateCollaborator(
        'collab-1',
        { name: 'Novo nome' },
        'dono-1',
      );

      expect(result.permissions).toEqual([Permission.AGENDA]);
    });

    it('devolve a permissão efetiva já somando Agenda/Atendimento/Solicitações ao virar médico nesta chamada', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'dono-1',
          role: UserRole.ADMIN,
          ownerId: 'dono-1',
        })
        .mockResolvedValueOnce({
          id: 'collab-1',
          role: UserRole.COLLABORATOR,
          ownerId: 'dono-1',
          adminId: 'dono-1',
          permissions: [],
          doctorProfile: null,
        });
      mockUserRepository.update.mockResolvedValue({
        id: 'collab-1',
        role: UserRole.COLLABORATOR,
      });

      const result = await service.updateCollaborator(
        'collab-1',
        { isDoctor: true, crm: '123', crmState: 'SP' },
        'dono-1',
      );

      expect(mockDoctorProfileRepository.create).toHaveBeenCalled();
      expect(result.permissions).toEqual([
        Permission.AGENDA,
        Permission.ATENDIMENTO,
        Permission.SOLICITACOES,
      ]);
      expect(result.grantedPermissions).toEqual([]);
    });

    describe('evento user.access_changed', () => {
      it('emite o evento com userId e phone quando `permissions` muda', async () => {
        mockUserRepository.findOneWithProfile
          .mockResolvedValueOnce({
            id: 'dono-1',
            role: UserRole.ADMIN,
            ownerId: 'dono-1',
          })
          .mockResolvedValueOnce({
            id: 'collab-1',
            role: UserRole.COLLABORATOR,
            ownerId: 'dono-1',
            adminId: 'dono-1',
            phone: '+5511999999999',
            permissions: [],
            doctorProfile: null,
          });
        mockUserRepository.update.mockResolvedValue({
          id: 'collab-1',
          role: UserRole.COLLABORATOR,
        });

        await service.updateCollaborator(
          'collab-1',
          { permissions: [Permission.SOLICITACOES] } as never,
          'dono-1',
        );

        expect(mockEventEmitter.emit).toHaveBeenCalledWith(
          'user.access_changed',
          { userId: 'collab-1', phone: '+5511999999999' },
        );
      });

      it('emite o evento quando `isDoctor` muda, mesmo sem tocar em `permissions`', async () => {
        mockUserRepository.findOneWithProfile
          .mockResolvedValueOnce({
            id: 'dono-1',
            role: UserRole.ADMIN,
            ownerId: 'dono-1',
          })
          .mockResolvedValueOnce({
            id: 'collab-1',
            role: UserRole.COLLABORATOR,
            ownerId: 'dono-1',
            adminId: 'dono-1',
            phone: '+5511999999999',
            permissions: [],
            doctorProfile: null,
          });
        mockUserRepository.update.mockResolvedValue({
          id: 'collab-1',
          role: UserRole.COLLABORATOR,
        });

        await service.updateCollaborator(
          'collab-1',
          { isDoctor: true, crm: '123', crmState: 'SP' },
          'dono-1',
        );

        expect(mockEventEmitter.emit).toHaveBeenCalledWith(
          'user.access_changed',
          { userId: 'collab-1', phone: '+5511999999999' },
        );
      });

      it('NÃO emite o evento quando nem `permissions` nem `isDoctor` mudam', async () => {
        mockUserRepository.findOneWithProfile
          .mockResolvedValueOnce({
            id: 'dono-1',
            role: UserRole.ADMIN,
            ownerId: 'dono-1',
          })
          .mockResolvedValueOnce({
            id: 'collab-1',
            role: UserRole.COLLABORATOR,
            ownerId: 'dono-1',
            adminId: 'dono-1',
            phone: '+5511999999999',
            permissions: [Permission.AGENDA],
            doctorProfile: null,
          });
        mockUserRepository.update.mockResolvedValue({
          id: 'collab-1',
          role: UserRole.COLLABORATOR,
        });

        await service.updateCollaborator(
          'collab-1',
          { name: 'Novo nome' },
          'dono-1',
        );

        expect(mockEventEmitter.emit).not.toHaveBeenCalled();
      });
    });
  });

  describe('permissões do colaborador', () => {
    it('grava as permissões informadas na criação', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'dono-1',
        role: UserRole.ADMIN,
        ownerId: 'dono-1',
        permissions: [],
        doctorProfile: null,
      });
      mockUserRepository.findOneWithDeleted.mockResolvedValue(null);
      mockUserRepository.create.mockResolvedValue({ id: 'novo-1' });

      await service.createCollaborator(
        {
          name: 'Ana',
          email: 'ana@x.com',
          phone: '11999999999',
          permissions: [Permission.AGENDA, Permission.ATENDIMENTO],
        } as never,
        'dono-1',
      );

      expect(mockUserRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          permissions: [Permission.AGENDA, Permission.ATENDIMENTO],
        }),
      );
    });

    it('cria sem permissão quando o campo é omitido', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'dono-1',
        role: UserRole.ADMIN,
        ownerId: 'dono-1',
        permissions: [],
        doctorProfile: null,
      });
      mockUserRepository.findOneWithDeleted.mockResolvedValue(null);
      mockUserRepository.create.mockResolvedValue({ id: 'novo-2' });

      await service.createCollaborator(
        { name: 'Bia', email: 'bia@x.com', phone: '11988888888' } as never,
        'dono-1',
      );

      expect(mockUserRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ permissions: [] }),
      );
    });

    it('devolve a permissão efetiva no perfil, não a coluna crua', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'med-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [],
        doctorProfile: { id: 'dp-1', council: 'CRM' },
      });

      const perfil = await service.getProfile('med-1');

      expect(perfil.permissions).toEqual([
        Permission.AGENDA,
        Permission.ATENDIMENTO,
        Permission.SOLICITACOES,
      ]);
    });
  });

  describe('deleteCollaborator', () => {
    beforeEach(() => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'dono-1',
        role: UserRole.ADMIN,
        ownerId: 'dono-1',
      });
    });

    it('deve deletar colaborador e retornar mensagem de sucesso', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'collab-1',
        email: 'collab@test.com',
        ownerId: 'dono-1',
        adminId: 'dono-1',
      });
      mockUserRepository.delete.mockResolvedValue(undefined);

      const result = await service.deleteCollaborator('collab-1', 'dono-1');

      expect(result).toEqual({ message: 'Colaborador desativado com sucesso' });
      expect(mockUserRepository.delete).toHaveBeenCalledWith('collab-1');
    });

    it('deve anonimizar phone no soft-delete (LGPD — minimização)', async () => {
      const collaboratorId = 'collab-uuid-0001';
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: collaboratorId,
        email: 'collab@test.com',
        phone: '+5511999990000',
        ownerId: 'dono-1',
        adminId: 'dono-1',
      });
      mockUserRepository.update.mockResolvedValue(undefined);
      mockUserRepository.delete.mockResolvedValue(undefined);

      await service.deleteCollaborator(collaboratorId, 'dono-1');

      expect(mockUserRepository.update).toHaveBeenCalledWith(
        collaboratorId,
        expect.objectContaining({
          phone: `DEL${collaboratorId.slice(0, 12)}`,
        }),
      );
    });

    it('após soft-delete, findOneByPhone com telefone original deve retornar null', async () => {
      const originalPhone = '+5511999990001';
      const collaboratorId = 'collab-uuid-0002';

      mockUserRepository.findOne.mockResolvedValueOnce({
        id: collaboratorId,
        email: 'collab2@test.com',
        phone: originalPhone,
        ownerId: 'dono-1',
        adminId: 'dono-1',
      });

      let storedPhone = originalPhone;
      mockUserRepository.update.mockImplementation((_id, data) => {
        if (data.phone !== undefined) storedPhone = data.phone;
        return Promise.resolve(undefined);
      });
      mockUserRepository.delete.mockResolvedValue(undefined);

      await service.deleteCollaborator(collaboratorId, 'dono-1');

      expect(storedPhone).not.toBe(originalPhone);
      expect(storedPhone).toBe(`DEL${collaboratorId.slice(0, 12)}`);
    });

    it('emite user.access_changed com o TELEFONE ORIGINAL, não a sentinela', async () => {
      const originalPhone = '+5511999990002';
      const collaboratorId = 'collab-uuid-0003';
      const sentinelPhone = `DEL${collaboratorId.slice(0, 12)}`;

      mockUserRepository.findOne.mockResolvedValueOnce({
        id: collaboratorId,
        email: 'collab3@test.com',
        phone: originalPhone,
        ownerId: 'dono-1',
        adminId: 'dono-1',
      });
      mockUserRepository.update.mockResolvedValueOnce({
        id: collaboratorId,
        phone: sentinelPhone,
      });
      mockUserRepository.delete.mockResolvedValue(undefined);

      await service.deleteCollaborator(collaboratorId, 'dono-1');

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'user.access_changed',
        { userId: collaboratorId, phone: originalPhone },
      );
      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
        'user.access_changed',
        expect.objectContaining({ phone: sentinelPhone }),
      );
    });

    it('deve lançar ForbiddenException se não é admin', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'user-1',
        role: UserRole.COLLABORATOR,
        permissions: [],
        doctorProfile: null,
      });

      await expect(
        service.deleteCollaborator('collab-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar NotFoundException se colaborador não existe', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.deleteCollaborator('invalid', 'dono-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve lançar ForbiddenException se colaborador pertence a outro tenant', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'collab-1',
        ownerId: 'outro-dono',
      });

      await expect(
        service.deleteCollaborator('collab-1', 'dono-1'),
      ).rejects.toThrow('Este colaborador não pertence à sua conta');
    });

    it('deve lançar ForbiddenException se o alvo é o dono da conta', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'delegado-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'dono-1',
        ownerId: 'dono-1',
        adminId: 'delegado-1',
      });

      await expect(
        service.deleteCollaborator('dono-1', 'delegado-1'),
      ).rejects.toThrow(
        'O dono da conta não pode ser alterado por outro usuário.',
      );
    });

    it('permite que o admin delegado exclua colaborador criado pelo dono', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'delegado-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'collab-do-dono',
        email: 'collab@test.com',
        ownerId: 'dono-1',
        adminId: 'dono-1',
      });
      mockUserRepository.delete.mockResolvedValue(undefined);

      await expect(
        service.deleteCollaborator('collab-do-dono', 'delegado-1'),
      ).resolves.toEqual({ message: 'Colaborador desativado com sucesso' });
    });
  });

  describe('resendCollaboratorInvite', () => {
    const adminUser = {
      id: 'dono-1',
      name: 'Admin',
      role: UserRole.ADMIN,
      ownerId: 'dono-1',
    };

    beforeEach(() => {
      mockUserRepository.findOneWithProfile.mockResolvedValue(adminUser);
    });

    it('deve gerar novo token, invalidar TODOS os anteriores e enviar e-mail', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'collab-1',
        name: 'Colaborador Pendente',
        email: 'pending@example.com',
        ownerId: 'dono-1',
        status: UserStatus.PENDING,
      });
      mockRecoveryCodeRepository.deleteMany.mockResolvedValue(undefined);
      mockRecoveryCodeRepository.create.mockResolvedValue({});

      const result = await service.resendCollaboratorInvite(
        'collab-1',
        'dono-1',
      );

      expect(mockRecoveryCodeRepository.deleteMany).toHaveBeenCalledWith({
        userId: 'collab-1',
      });
      expect(mockRecoveryCodeRepository.deleteMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ used: expect.anything() }),
      );
      expect(mockRecoveryCodeRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'collab-1',
          used: false,
          code: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      );
      expect(mockMailService.send).toHaveBeenCalledWith(
        'invite-collaborator',
        'pending@example.com',
        'Você foi convidado para a Inexci!',
        expect.objectContaining({
          collaboratorName: 'Colaborador Pendente',
          inviterName: 'Admin',
          email: 'pending@example.com',
          setupLink: expect.stringContaining('/primeiro-acesso?email='),
        }),
      );
      expect(result).toEqual({
        message: 'Convite reenviado com sucesso',
        email: 'pending@example.com',
      });
    });

    it('deve invalidar token antigo já validado (used=true) ao reenviar', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'collab-1',
        name: 'Colaborador Pendente',
        email: 'pending@example.com',
        ownerId: 'dono-1',
        status: UserStatus.PENDING,
      });
      mockRecoveryCodeRepository.deleteMany.mockResolvedValue(undefined);
      mockRecoveryCodeRepository.create.mockResolvedValue({});

      await service.resendCollaboratorInvite('collab-1', 'dono-1');

      const deleteCall =
        mockRecoveryCodeRepository.deleteMany.mock.invocationCallOrder[0];
      const createCall =
        mockRecoveryCodeRepository.create.mock.invocationCallOrder[0];
      expect(deleteCall).toBeLessThan(createCall);
    });

    it('deve lançar ForbiddenException se quem chama não é admin', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'user-1',
        role: UserRole.COLLABORATOR,
        permissions: [],
        doctorProfile: null,
      });

      await expect(
        service.resendCollaboratorInvite('collab-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar NotFoundException se colaborador não existe', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.resendCollaboratorInvite('invalid', 'dono-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve lançar ForbiddenException se colaborador é de outra conta', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'collab-1',
        ownerId: 'outro-dono',
        status: UserStatus.PENDING,
      });

      await expect(
        service.resendCollaboratorInvite('collab-1', 'dono-1'),
      ).rejects.toThrow('Este colaborador não pertence à sua conta');
    });

    it('deve lançar BadRequestException se colaborador já está ativo', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'collab-1',
        ownerId: 'dono-1',
        status: UserStatus.ACTIVE,
      });

      await expect(
        service.resendCollaboratorInvite('collab-1', 'dono-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockMailService.send).not.toHaveBeenCalled();
    });

    it('bloqueia reenvio de convite quando o alvo é o dono da conta', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'delegado-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'dono-1',
        ownerId: 'dono-1',
        adminId: 'delegado-1',
        status: UserStatus.PENDING,
      });

      await expect(
        service.resendCollaboratorInvite('dono-1', 'delegado-1'),
      ).rejects.toThrow(
        'O dono da conta não pode ser alterado por outro usuário.',
      );
      expect(mockMailService.send).not.toHaveBeenCalled();
    });

    it('permite que o admin delegado reenvie convite de colaborador criado pelo dono', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'delegado-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'collab-do-dono',
        name: 'Pendente',
        email: 'pendente@example.com',
        ownerId: 'dono-1',
        adminId: 'dono-1',
        status: UserStatus.PENDING,
      });
      mockRecoveryCodeRepository.deleteMany.mockResolvedValue(undefined);
      mockRecoveryCodeRepository.create.mockResolvedValue({});

      await expect(
        service.resendCollaboratorInvite('collab-do-dono', 'delegado-1'),
      ).resolves.toBeDefined();
    });
  });

  describe('toggleCollaboratorStatus / resetCollaboratorPassword — dono intocável', () => {
    it('bloqueia toggleCollaboratorStatus quando o alvo é o dono da conta', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'delegado-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'dono-1',
        ownerId: 'dono-1',
        adminId: 'delegado-1',
        status: UserStatus.ACTIVE,
      });

      await expect(
        service.toggleCollaboratorStatus('dono-1', 'delegado-1'),
      ).rejects.toThrow(
        'O dono da conta não pode ser alterado por outro usuário.',
      );
    });

    it('bloqueia resetCollaboratorPassword quando o alvo é o dono da conta', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'delegado-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'dono-1',
        ownerId: 'dono-1',
        adminId: 'delegado-1',
      });

      await expect(
        service.resetCollaboratorPassword('dono-1', 'nova-senha', 'delegado-1'),
      ).rejects.toThrow(
        'O dono da conta não pode ser alterado por outro usuário.',
      );
    });

    it('permite que o dono altere status de colaborador criado por um admin delegado', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'dono-1',
        role: UserRole.ADMIN,
        ownerId: 'dono-1',
      });
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'collab-do-delegado',
        ownerId: 'dono-1',
        adminId: 'delegado-1',
        status: UserStatus.ACTIVE,
      });
      mockUserRepository.update.mockResolvedValue(undefined);

      await expect(
        service.toggleCollaboratorStatus('collab-do-delegado', 'dono-1'),
      ).resolves.toEqual({ status: UserStatus.INACTIVE });
    });

    it('permite que o dono redefina a senha de colaborador criado por um admin delegado', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'dono-1',
        role: UserRole.ADMIN,
        ownerId: 'dono-1',
      });
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'collab-do-delegado',
        ownerId: 'dono-1',
        adminId: 'delegado-1',
      });
      mockUserRepository.update.mockResolvedValue(undefined);

      await expect(
        service.resetCollaboratorPassword(
          'collab-do-delegado',
          'nova-senha',
          'dono-1',
        ),
      ).resolves.toEqual({ message: 'Senha redefinida com sucesso' });
      expect(mockRefreshTokenStore.revokeAllForUser).toHaveBeenCalledWith(
        'collab-do-delegado',
      );
    });
  });

  describe('toggleCollaboratorStatus — evento user.access_changed', () => {
    it('emite o evento ao desativar um colaborador ativo', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'dono-1',
        role: UserRole.ADMIN,
        ownerId: 'dono-1',
      });
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'collab-1',
        ownerId: 'dono-1',
        adminId: 'dono-1',
        phone: '+5511999998888',
        status: UserStatus.ACTIVE,
      });
      mockUserRepository.update.mockResolvedValue(undefined);

      const result = await service.toggleCollaboratorStatus(
        'collab-1',
        'dono-1',
      );

      expect(result).toEqual({ status: UserStatus.INACTIVE });
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'user.access_changed',
        { userId: 'collab-1', phone: '+5511999998888' },
      );
    });

    it('emite o evento também ao reativar um colaborador inativo', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'dono-1',
        role: UserRole.ADMIN,
        ownerId: 'dono-1',
      });
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'collab-1',
        ownerId: 'dono-1',
        adminId: 'dono-1',
        phone: '+5511999998888',
        status: UserStatus.INACTIVE,
      });
      mockUserRepository.update.mockResolvedValue(undefined);

      const result = await service.toggleCollaboratorStatus(
        'collab-1',
        'dono-1',
      );

      expect(result).toEqual({ status: UserStatus.ACTIVE });
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'user.access_changed',
        { userId: 'collab-1', phone: '+5511999998888' },
      );
    });
  });

  describe('bulkDeleteCollaborators', () => {
    const getRepositoryMock = {
      find: mockUserRepository.findCollaboratorsByIds,
      softDelete: mockUserRepository.bulkSoftDelete,
    };

    beforeEach(() => {
      getRepositoryMock.find.mockReset();
      getRepositoryMock.softDelete.mockReset();
    });

    it('deixa admin delegado excluir colaboradores em lote criados pelo dono', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'delegado-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });
      getRepositoryMock.find.mockResolvedValue([
        { id: 'collab-1', email: 'a@x.com', ownerId: 'dono-1' },
        { id: 'collab-2', email: 'b@x.com', ownerId: 'dono-1' },
      ]);
      getRepositoryMock.softDelete.mockResolvedValue(undefined);

      const result = await service.bulkDeleteCollaborators(
        ['collab-1', 'collab-2'],
        'delegado-1',
      );

      expect(result).toEqual({ deleted: 2 });
      expect(getRepositoryMock.find).toHaveBeenCalledWith(
        ['collab-1', 'collab-2'],
        'dono-1',
      );
    });

    it('emite user.access_changed com o telefone original de CADA colaborador excluído', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'delegado-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });
      getRepositoryMock.find.mockResolvedValue([
        {
          id: 'collab-1',
          email: 'a@x.com',
          ownerId: 'dono-1',
          phone: '+5511900000001',
        },
        {
          id: 'collab-2',
          email: 'b@x.com',
          ownerId: 'dono-1',
          phone: '+5511900000002',
        },
      ]);
      getRepositoryMock.softDelete.mockResolvedValue(undefined);

      await service.bulkDeleteCollaborators(
        ['collab-1', 'collab-2'],
        'delegado-1',
      );

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'user.access_changed',
        { userId: 'collab-1', phone: '+5511900000001' },
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'user.access_changed',
        { userId: 'collab-2', phone: '+5511900000002' },
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(2);
    });

    it('bloqueia bulk delete se o dono da conta estiver na lista', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'delegado-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });
      getRepositoryMock.find.mockResolvedValue([
        { id: 'collab-1', email: 'a@x.com', ownerId: 'dono-1' },
        { id: 'dono-1', email: 'dono@x.com', ownerId: 'dono-1' },
      ]);

      await expect(
        service.bulkDeleteCollaborators(['collab-1', 'dono-1'], 'delegado-1'),
      ).rejects.toThrow(
        'O dono da conta não pode ser alterado por outro usuário.',
      );
      expect(getRepositoryMock.softDelete).not.toHaveBeenCalled();
    });

    it('bloqueia colaborador sem administração', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'comum-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.AGENDA],
        doctorProfile: null,
      });

      await expect(
        service.bulkDeleteCollaborators(['collab-1'], 'comum-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateDoctorProfileById', () => {
    it('deve permitir médico editar próprio perfil', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'user-1',
          role: UserRole.COLLABORATOR,
          doctorProfile: { id: 'dp-1', crm: '111', crmState: 'RJ' },
        })
        .mockResolvedValueOnce({
          id: 'user-1',
          doctorProfile: { id: 'dp-1', crm: '111', crmState: 'RJ' },
        })
        .mockResolvedValueOnce({
          id: 'user-1',
          doctorProfile: { id: 'dp-1', crm: '999999', crmState: 'RJ' },
        });

      const result = await service.updateDoctorProfileById(
        'user-1',
        { crm: '999999' },
        'user-1',
      );

      expect(mockDoctorProfileRepository.update).toHaveBeenCalledWith(
        'dp-1',
        expect.objectContaining({ crm: '999999' }),
      );
    });

    it('deve lançar BadRequestException se alvo não é médico', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'admin-1',
          role: UserRole.ADMIN,
        })
        .mockResolvedValueOnce({
          id: 'user-2',
          doctorProfile: null,
          adminId: 'admin-1',
        });

      await expect(
        service.updateDoctorProfileById('user-2', { crm: '123' }, 'admin-1'),
      ).rejects.toThrow('Este usuário não é médico');
    });

    it('deve lançar ForbiddenException se não é o próprio nem admin', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'other-user',
          role: UserRole.COLLABORATOR,
        })
        .mockResolvedValueOnce({
          id: 'doctor-1',
          doctorProfile: { id: 'dp-1', council: 'CRM' },
          adminId: 'real-admin',
        });

      await expect(
        service.updateDoctorProfileById(
          'doctor-1',
          { crm: '123' },
          'other-user',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve permitir colaborador vinculado atualizar a assinatura do médico', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'collab-1',
          role: UserRole.COLLABORATOR,
        })
        .mockResolvedValueOnce({
          id: 'doctor-1',
          ownerId: 'real-admin',
          doctorProfile: { id: 'dp-1', council: 'CRM' },
          adminId: 'real-admin',
        })
        .mockResolvedValueOnce({
          id: 'doctor-1',
          doctorProfile: {
            id: 'dp-1',
            signatureUrl: 'signatures/real-admin/x.png',
          },
          permissions: [Permission.SOLICITACOES],
          isPlatformAdmin: true,
          onboardingState: null,
        });
      mockUserDoctorAccessRepository.findActiveByUserId.mockResolvedValue([
        { doctorUserId: 'doctor-1' },
      ]);

      const result = await service.updateDoctorProfileById(
        'doctor-1',
        { signatureImageUrl: 'signatures/real-admin/x.png' },
        'collab-1',
      );

      expect(mockDoctorProfileRepository.update).toHaveBeenCalledWith(
        'dp-1',
        expect.objectContaining({
          signatureUrl: 'signatures/real-admin/x.png',
        }),
      );
      expect(result).not.toHaveProperty('permissions');
      expect(result).not.toHaveProperty('isPlatformAdmin');
    });

    it('não expõe onboardingState cru do médico-alvo (nem null)', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'collab-1',
          role: UserRole.COLLABORATOR,
        })
        .mockResolvedValueOnce({
          id: 'doctor-1',
          ownerId: 'real-admin',
          doctorProfile: { id: 'dp-1', council: 'CRM' },
          adminId: 'real-admin',
        })
        .mockResolvedValueOnce({
          id: 'doctor-1',
          doctorProfile: {
            id: 'dp-1',
            signatureUrl: 'signatures/real-admin/x.png',
          },
          permissions: [Permission.SOLICITACOES],
          isPlatformAdmin: false,
          onboardingState: null,
        });
      mockUserDoctorAccessRepository.findActiveByUserId.mockResolvedValue([
        { doctorUserId: 'doctor-1' },
      ]);

      const result = await service.updateDoctorProfileById(
        'doctor-1',
        { signatureImageUrl: 'signatures/real-admin/x.png' },
        'collab-1',
      );

      expect(result).not.toHaveProperty('onboardingState');
    });

    it('deve barrar colaborador vinculado que tenta editar CRM', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'collab-1',
          role: UserRole.COLLABORATOR,
        })
        .mockResolvedValueOnce({
          id: 'doctor-1',
          doctorProfile: { id: 'dp-1', council: 'CRM' },
          adminId: 'real-admin',
        });
      mockUserDoctorAccessRepository.findActiveByUserId.mockResolvedValue([
        { doctorUserId: 'doctor-1' },
      ]);

      await expect(
        service.updateDoctorProfileById(
          'doctor-1',
          { crm: '123', signatureImageUrl: 'signatures/x.png' },
          'collab-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('permite que o admin delegado edite CRM de médico criado pelo dono', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'delegado-1',
          role: UserRole.COLLABORATOR,
          ownerId: 'dono-1',
          permissions: [Permission.ADMINISTRACAO],
          doctorProfile: null,
        })
        .mockResolvedValueOnce({
          id: 'doctor-1',
          ownerId: 'dono-1',
          adminId: 'dono-1',
          doctorProfile: { id: 'dp-1', crm: '111', crmState: 'RJ' },
        })
        .mockResolvedValueOnce({
          id: 'doctor-1',
          ownerId: 'dono-1',
          doctorProfile: { id: 'dp-1', crm: '999999', crmState: 'RJ' },
        });

      await service.updateDoctorProfileById(
        'doctor-1',
        { crm: '999999' },
        'delegado-1',
      );

      expect(mockDoctorProfileRepository.update).toHaveBeenCalledWith(
        'dp-1',
        expect.objectContaining({ crm: '999999' }),
      );
    });

    it('bloqueia edição de CRM de médico de outro tenant mesmo com Administração', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'delegado-1',
          role: UserRole.COLLABORATOR,
          ownerId: 'dono-1',
          permissions: [Permission.ADMINISTRACAO],
          doctorProfile: null,
        })
        .mockResolvedValueOnce({
          id: 'doctor-de-outro-tenant',
          ownerId: 'outro-dono',
          adminId: 'outro-dono',
          doctorProfile: { id: 'dp-2', crm: '222', crmState: 'SP' },
        });
      mockUserDoctorAccessRepository.findActiveByUserId.mockResolvedValue([]);

      await expect(
        service.updateDoctorProfileById(
          'doctor-de-outro-tenant',
          { crm: '999999' },
          'delegado-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateDoctorProfileById — registro profissional do dono da conta', () => {
    const delegado = {
      id: 'delegado-1',
      role: UserRole.COLLABORATOR,
      ownerId: 'dono-1',
      permissions: [Permission.ADMINISTRACAO],
      doctorProfile: null,
    };
    const dono = {
      id: 'dono-1',
      role: UserRole.ADMIN,
      ownerId: 'dono-1',
      phone: '11999990000',
      doctorProfile: {
        id: 'dp-dono',
        council: ProfessionalCouncil.CRM,
        crm: '111',
        crmState: 'RJ',
      },
    };

    it.each([
      ['conselho', { council: ProfessionalCouncil.CRN }],
      ['número', { crm: '999' }],
      ['UF', { crmState: 'SP' }],
      ['especialidade', { specialty: 'Nutrição' }],
    ])(
      'admin delegado não altera o %s do dono da conta',
      async (_campo, dto) => {
        mockUserRepository.findOneWithProfile
          .mockResolvedValueOnce(delegado)
          .mockResolvedValueOnce(dono);

        await expect(
          service.updateDoctorProfileById('dono-1', dto, 'delegado-1'),
        ).rejects.toThrow(ForbiddenException);
        expect(mockDoctorProfileRepository.update).not.toHaveBeenCalled();
        expect(mockEventEmitter.emit).not.toHaveBeenCalled();
      },
    );

    it('o dono altera o próprio conselho', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce(dono)
        .mockResolvedValueOnce(dono)
        .mockResolvedValueOnce(dono);

      await service.updateDoctorProfileById(
        'dono-1',
        { council: ProfessionalCouncil.CRO, crm: '222', crmState: 'RJ' },
        'dono-1',
      );

      expect(mockDoctorProfileRepository.update).toHaveBeenCalledWith(
        'dp-dono',
        expect.objectContaining({ council: ProfessionalCouncil.CRO }),
      );
    });

    it('colaborador vinculado ao dono ainda troca só a assinatura dele', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'collab-1',
          role: UserRole.COLLABORATOR,
          ownerId: 'dono-1',
          permissions: [Permission.SOLICITACOES],
          doctorProfile: null,
        })
        .mockResolvedValueOnce(dono)
        .mockResolvedValueOnce(dono);
      mockUserDoctorAccessRepository.findActiveByUserId.mockResolvedValue([
        { doctorUserId: 'dono-1' },
      ]);

      await service.updateDoctorProfileById(
        'dono-1',
        { signatureImageUrl: 'signatures/dono-1/dono.png' },
        'collab-1',
      );

      expect(mockDoctorProfileRepository.update).toHaveBeenCalledWith(
        'dp-dono',
        { signatureUrl: 'signatures/dono-1/dono.png' },
      );
    });

    it('admin delegado NÃO troca a assinatura do dono (só por ser admin)', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce(delegado)
        .mockResolvedValueOnce(dono);
      mockUserDoctorAccessRepository.findActiveByUserId.mockResolvedValue([]);

      await expect(
        service.updateDoctorProfileById(
          'dono-1',
          { signatureImageUrl: 'signatures/dono-1/outra.png' },
          'delegado-1',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockDoctorProfileRepository.update).not.toHaveBeenCalled();
    });

    it('nem remove a assinatura do dono (null)', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce(delegado)
        .mockResolvedValueOnce(dono);
      mockUserDoctorAccessRepository.findActiveByUserId.mockResolvedValue([]);

      await expect(
        service.updateDoctorProfileById(
          'dono-1',
          { signatureImageUrl: null },
          'delegado-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('admin delegado que também é vinculado ao dono troca a assinatura dele', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce(delegado)
        .mockResolvedValueOnce(dono)
        .mockResolvedValueOnce(dono);
      mockUserDoctorAccessRepository.findActiveByUserId.mockResolvedValue([
        { doctorUserId: 'dono-1' },
      ]);

      await service.updateDoctorProfileById(
        'dono-1',
        { signatureImageUrl: 'signatures/dono-1/nova.png' },
        'delegado-1',
      );

      expect(mockDoctorProfileRepository.update).toHaveBeenCalledWith(
        'dp-dono',
        { signatureUrl: 'signatures/dono-1/nova.png' },
      );
    });

    it('admin delegado segue trocando a assinatura de outro profissional da conta', async () => {
      const profissional = {
        id: 'doctor-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        doctorProfile: { id: 'dp-1', council: ProfessionalCouncil.CRM },
      };
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce(delegado)
        .mockResolvedValueOnce(profissional)
        .mockResolvedValueOnce(profissional);

      await service.updateDoctorProfileById(
        'doctor-1',
        { signatureImageUrl: 'signatures/dono-1/nova.png' },
        'delegado-1',
      );

      expect(mockDoctorProfileRepository.update).toHaveBeenCalledWith('dp-1', {
        signatureUrl: 'signatures/dono-1/nova.png',
      });
      expect(
        mockUserDoctorAccessRepository.findActiveByUserId,
      ).not.toHaveBeenCalled();
    });
  });

  describe('updateDoctorProfileById — caminho da assinatura', () => {
    const profissional = {
      id: 'doctor-1',
      role: UserRole.COLLABORATOR,
      ownerId: 'dono-1',
      doctorProfile: {
        id: 'dp-1',
        council: ProfessionalCouncil.CRM,
        signatureUrl: 'signatures/legado.png',
      },
    };

    it.each([
      ['foto de paciente', 'patient-photos/dono-1/uuid-foto.webp'],
      ['assinatura de outra conta', 'signatures/outro-dono/a.png'],
      ['travessia', 'signatures/dono-1/../../patient-photos/dono-1/f.webp'],
    ])('recusa %s (400) e não grava', async (_rotulo, caminho) => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce(profissional)
        .mockResolvedValueOnce(profissional);

      await expect(
        service.updateDoctorProfileById(
          'doctor-1',
          { signatureImageUrl: caminho },
          'doctor-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockDoctorProfileRepository.update).not.toHaveBeenCalled();
    });

    it('reenviar o caminho atual (mesmo legado) passa', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce(profissional)
        .mockResolvedValueOnce(profissional)
        .mockResolvedValueOnce(profissional);

      await service.updateDoctorProfileById(
        'doctor-1',
        { signatureImageUrl: 'signatures/legado.png' },
        'doctor-1',
      );

      expect(mockDoctorProfileRepository.update).toHaveBeenCalledWith('dp-1', {
        signatureUrl: 'signatures/legado.png',
      });
    });
  });

  describe('updateDoctorProfileById — profissional só com Atendimento', () => {
    const nutri = {
      id: 'nutri-1',
      role: UserRole.COLLABORATOR,
      ownerId: 'dono-1',
      permissions: [],
      doctorProfile: {
        id: 'dp-n',
        council: ProfessionalCouncil.CRN,
        crm: '123',
        crmState: 'RJ',
      },
    };

    it('salva os próprios dados (mesmo sem Solicitações)', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce(nutri)
        .mockResolvedValueOnce(nutri)
        .mockResolvedValueOnce(nutri);

      await service.updateDoctorProfileById(
        'nutri-1',
        { specialty: 'Nutrição esportiva', crm: '456' },
        'nutri-1',
      );

      expect(mockDoctorProfileRepository.update).toHaveBeenCalledWith(
        'dp-n',
        expect.objectContaining({
          specialty: 'Nutrição esportiva',
          crm: '456',
        }),
      );
    });

    it.each([
      ['a assinatura', { signatureImageUrl: 'signatures/x.png' }],
      ['a especialidade', { specialty: 'Cardiologia' }],
    ])(
      'não altera %s de outro profissional sem vínculo',
      async (_campo, dto) => {
        mockUserRepository.findOneWithProfile
          .mockResolvedValueOnce(nutri)
          .mockResolvedValueOnce({
            id: 'doctor-1',
            ownerId: 'dono-1',
            doctorProfile: { id: 'dp-1', council: ProfessionalCouncil.CRM },
          });
        mockUserDoctorAccessRepository.findActiveByUserId.mockResolvedValue([]);

        await expect(
          service.updateDoctorProfileById('doctor-1', dto, 'nutri-1'),
        ).rejects.toThrow(ForbiddenException);
        expect(mockDoctorProfileRepository.update).not.toHaveBeenCalled();
      },
    );
  });

  describe('getDoctorHeaderByUserId — admin delegado', () => {
    it('permite admin delegado (role=collaborator + Administração) configurar o cabeçalho de médico criado pelo dono', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValueOnce({
        id: 'delegado-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'doctor-1',
        ownerId: 'dono-1',
        adminId: 'dono-1',
      });
      mockDoctorProfileRepository.findByUserId.mockResolvedValue({
        id: 'profile-1',
      });
      mockDoctorHeaderRepository.findByDoctorProfileId.mockResolvedValue({
        id: 'header-1',
      });

      const result = await service.getDoctorHeaderByUserId(
        'doctor-1',
        'delegado-1',
      );

      expect(result).toEqual({ id: 'header-1' });
    });

    it('permite que o dono configure o cabeçalho de médico criado por um admin delegado', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValueOnce({
        id: 'dono-1',
        role: UserRole.ADMIN,
        ownerId: 'dono-1',
      });
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'doctor-1',
        ownerId: 'dono-1',
        adminId: 'delegado-1',
      });
      mockDoctorProfileRepository.findByUserId.mockResolvedValue({
        id: 'profile-1',
      });
      mockDoctorHeaderRepository.findByDoctorProfileId.mockResolvedValue({
        id: 'header-1',
      });

      const result = await service.getDoctorHeaderByUserId(
        'doctor-1',
        'dono-1',
      );

      expect(result).toEqual({ id: 'header-1' });
    });

    it('bloqueia colaborador sem Administração de configurar o cabeçalho de outro médico', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValueOnce({
        id: 'comum-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.AGENDA],
        doctorProfile: null,
      });
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'doctor-1',
        ownerId: 'dono-1',
        adminId: 'outro-admin',
      });

      await expect(
        service.getDoctorHeaderByUserId('doctor-1', 'comum-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getMyHeader', () => {
    it('deve retornar null se usuário não é médico', async () => {
      mockDoctorProfileRepository.findByUserId.mockResolvedValue(null);
      const result = await service.getMyHeader('user-1');
      expect(result).toBeNull();
    });

    it('deve retornar o cabeçalho do médico', async () => {
      mockDoctorProfileRepository.findByUserId.mockResolvedValue({
        id: 'profile-1',
      });
      const header = {
        id: 'header-1',
        logoUrl: null,
        logoPosition: 'left',
        contentHtml: '<p>Texto</p>',
      };
      mockDoctorHeaderRepository.findByDoctorProfileId.mockResolvedValue(
        header,
      );
      const result = await service.getMyHeader('user-1');
      expect(result).toEqual(header);
    });
  });

  describe('upsertMyHeader', () => {
    it('deve lançar ForbiddenException se usuário não é médico', async () => {
      mockDoctorProfileRepository.findByUserId.mockResolvedValue(null);
      await expect(
        service.upsertMyHeader('user-1', {
          logoPosition: 'left',
          contentHtml: '<p>Texto</p>',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve sanitizar HTML antes de persistir', async () => {
      mockDoctorProfileRepository.findByUserId.mockResolvedValue({
        id: 'profile-1',
      });
      const maliciousHtml = '<p>Texto</p><script>alert("xss")</script>';
      const savedHeader = {
        id: 'header-1',
        logoPosition: 'left',
        contentHtml: '<p>Texto</p>',
      };
      mockDoctorHeaderRepository.upsert.mockResolvedValue(savedHeader);

      await service.upsertMyHeader('user-1', { contentHtml: maliciousHtml });

      const upsertCall = mockDoctorHeaderRepository.upsert.mock.calls[0];
      expect(upsertCall[1].contentHtml).not.toContain('<script>');
    });

    it('deve chamar upsert com os dados corretos', async () => {
      mockDoctorProfileRepository.findByUserId.mockResolvedValue({
        id: 'profile-1',
      });
      const header = {
        id: 'header-1',
        logoPosition: 'right',
        contentHtml: '<p>Clínica</p>',
      };
      mockDoctorHeaderRepository.upsert.mockResolvedValue(header);

      const result = await service.upsertMyHeader('user-1', {
        logoPosition: 'right',
        contentHtml: '<p>Clínica</p>',
      });

      expect(mockDoctorHeaderRepository.upsert).toHaveBeenCalledWith(
        'profile-1',
        expect.objectContaining({ logoPosition: 'right' }),
      );
      expect(result).toEqual(header);
    });
  });

  describe('changePassword', () => {
    it('deve lançar UnauthorizedException quando usuário não possui senha definida', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        password: null,
      });

      await expect(
        service.changePassword('user-1', 'any-current', 'new-password'),
      ).rejects.toThrow(UnauthorizedException);

      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        password: undefined,
      });

      await expect(
        service.changePassword('user-1', 'any-current', 'new-password'),
      ).rejects.toMatchObject({
        message:
          'Conta sem senha definida. Acesse pelo link de primeiro acesso.',
        status: 401,
      });
    });
  });

  describe('deleteMyHeader', () => {
    it('deve lançar ForbiddenException se usuário não é médico', async () => {
      mockDoctorProfileRepository.findByUserId.mockResolvedValue(null);
      await expect(service.deleteMyHeader('user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('deve chamar removeByDoctorProfileId', async () => {
      mockDoctorProfileRepository.findByUserId.mockResolvedValue({
        id: 'profile-1',
      });
      mockDoctorHeaderRepository.removeByDoctorProfileId.mockResolvedValue(
        undefined,
      );

      const result = await service.deleteMyHeader('user-1');
      expect(
        mockDoctorHeaderRepository.removeByDoctorProfileId,
      ).toHaveBeenCalledWith('profile-1');
      expect(result).toEqual({ message: 'Cabeçalho removido com sucesso' });
    });
  });
  describe('conselho profissional (MIG-02)', () => {
    const adminUser = {
      id: 'dono-1',
      name: 'Admin',
      role: UserRole.ADMIN,
      ownerId: 'dono-1',
    };

    describe('createCollaborator', () => {
      beforeEach(() => {
        mockUserRepository.findOneWithProfile.mockResolvedValue(adminUser);
        mockUserRepository.findOne.mockResolvedValue(null);
        mockUserRepository.findOneWithDeleted.mockResolvedValue(null);
        mockDoctorProfileRepository.findByUserId.mockResolvedValue(null);
        mockUserRepository.create.mockResolvedValue({
          id: 'new-1',
          name: 'Nutri',
          email: 'nutri@email.com',
          role: UserRole.COLLABORATOR,
          permissions: [],
        });
      });

      it('cria perfil de nutricionista sem número, com agenda e atendimento', async () => {
        const result = await service.createCollaborator(
          {
            name: 'Nutri',
            email: 'nutri@email.com',
            phone: '11999998888',
            isDoctor: true,
            council: ProfessionalCouncil.CRN,
          },
          'dono-1',
        );

        expect(mockDoctorProfileRepository.create).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'new-1',
            council: ProfessionalCouncil.CRN,
            crm: null,
            crmState: null,
          }),
        );
        expect(result.permissions).toEqual([
          Permission.AGENDA,
          Permission.ATENDIMENTO,
        ]);
      });

      it('médico sem council continua CRM e ganha solicitações', async () => {
        const result = await service.createCollaborator(
          {
            name: 'Dr',
            email: 'dr@email.com',
            phone: '11999998888',
            isDoctor: true,
            crm: '123',
            crmState: 'RJ',
          },
          'dono-1',
        );

        expect(mockDoctorProfileRepository.create).toHaveBeenCalledWith(
          expect.objectContaining({ council: ProfessionalCouncil.CRM }),
        );
        expect(result.permissions).toContain(Permission.SOLICITACOES);
      });

      it('recusa CRM sem número mesmo que o DTO deixe passar', async () => {
        await expect(
          service.createCollaborator(
            {
              name: 'Dr',
              email: 'dr@email.com',
              phone: '11999998888',
              isDoctor: true,
              council: ProfessionalCouncil.CRM,
            },
            'dono-1',
          ),
        ).rejects.toThrow(BadRequestException);
        expect(mockUserRepository.create).not.toHaveBeenCalled();
      });
    });

    describe('updateCollaborator', () => {
      const colaboradorCrm = {
        id: 'collab-1',
        ownerId: 'dono-1',
        adminId: 'dono-1',
        phone: '11999990000',
        permissions: [],
        doctorProfile: {
          id: 'dp-1',
          council: ProfessionalCouncil.CRM,
          crm: '123',
          crmState: 'RJ',
        },
      };

      beforeEach(() => {
        mockUserRepository.findOneWithProfile
          .mockResolvedValueOnce(adminUser)
          .mockResolvedValueOnce(colaboradorCrm);
        mockUserRepository.findOne.mockResolvedValue(null);
        mockUserRepository.update.mockResolvedValue({ id: 'collab-1' });
      });

      it('trocar para COREN tira solicitações e avisa o assistente', async () => {
        const result = await service.updateCollaborator(
          'collab-1',
          { council: ProfessionalCouncil.COREN },
          'dono-1',
        );

        expect(mockDoctorProfileRepository.update).toHaveBeenCalledWith(
          'dp-1',
          expect.objectContaining({ council: ProfessionalCouncil.COREN }),
        );
        expect(result.permissions).not.toContain(Permission.SOLICITACOES);
        expect(mockEventEmitter.emit).toHaveBeenCalled();
      });

      it('recusa apagar o número de um médico CRM', async () => {
        await expect(
          service.updateCollaborator('collab-1', { crm: '' }, 'dono-1'),
        ).rejects.toThrow(BadRequestException);
        expect(mockDoctorProfileRepository.update).not.toHaveBeenCalled();
      });
    });

    describe('updateDoctorProfileById', () => {
      it('o próprio profissional não troca o conselho', async () => {
        const nutri = {
          id: 'nutri-1',
          role: UserRole.COLLABORATOR,
          ownerId: 'dono-1',
          permissions: [],
          doctorProfile: { id: 'dp-n', council: ProfessionalCouncil.CRN },
        };
        mockUserRepository.findOneWithProfile
          .mockResolvedValueOnce(nutri)
          .mockResolvedValueOnce(nutri);

        await expect(
          service.updateDoctorProfileById(
            'nutri-1',
            {
              council: ProfessionalCouncil.CRM,
              crm: '999',
              crmState: 'RJ',
            },
            'nutri-1',
          ),
        ).rejects.toThrow(ForbiddenException);
        expect(mockDoctorProfileRepository.update).not.toHaveBeenCalled();
      });

      it('a administração troca o conselho e o assistente é avisado', async () => {
        mockUserRepository.findOneWithProfile
          .mockResolvedValueOnce(adminUser)
          .mockResolvedValueOnce({
            id: 'nutri-1',
            ownerId: 'dono-1',
            phone: '11999990000',
            doctorProfile: { id: 'dp-n', council: ProfessionalCouncil.CRN },
          })
          .mockResolvedValueOnce({
            id: 'nutri-1',
            doctorProfile: { id: 'dp-n', council: ProfessionalCouncil.COREN },
          });

        await service.updateDoctorProfileById(
          'nutri-1',
          { council: ProfessionalCouncil.COREN },
          'dono-1',
        );

        expect(mockDoctorProfileRepository.update).toHaveBeenCalledWith(
          'dp-n',
          expect.objectContaining({ council: ProfessionalCouncil.COREN }),
        );
        expect(mockEventEmitter.emit).toHaveBeenCalled();
      });

      describe('admin delegado que também é profissional', () => {
        const delegadoNutri = {
          id: 'delegado-1',
          role: UserRole.COLLABORATOR,
          ownerId: 'dono-1',
          phone: '11999990001',
          permissions: [Permission.ADMINISTRACAO],
          doctorProfile: {
            id: 'dp-d',
            council: ProfessionalCouncil.CRN,
            crm: '55',
            crmState: 'RJ',
          },
        };

        it('não se promove a médico (CRM) pela rota de perfil profissional', async () => {
          mockUserRepository.findOneWithProfile
            .mockResolvedValueOnce(delegadoNutri)
            .mockResolvedValueOnce(delegadoNutri);

          await expect(
            service.updateDoctorProfileById(
              'delegado-1',
              { council: ProfessionalCouncil.CRM, crm: '999', crmState: 'RJ' },
              'delegado-1',
            ),
          ).rejects.toThrow(ForbiddenException);
          expect(mockDoctorProfileRepository.update).not.toHaveBeenCalled();
        });

        it('ainda edita o próprio número, UF e especialidade', async () => {
          mockUserRepository.findOneWithProfile
            .mockResolvedValueOnce(delegadoNutri)
            .mockResolvedValueOnce(delegadoNutri)
            .mockResolvedValueOnce(delegadoNutri);

          await service.updateDoctorProfileById(
            'delegado-1',
            {
              council: ProfessionalCouncil.CRN,
              crm: '77',
              crmState: 'SP',
              specialty: 'Nutrição clínica',
            },
            'delegado-1',
          );

          expect(mockDoctorProfileRepository.update).toHaveBeenCalledWith(
            'dp-d',
            expect.objectContaining({ crm: '77', crmState: 'SP' }),
          );
        });

        it('outro admin (o dono) troca o conselho dele', async () => {
          mockUserRepository.findOneWithProfile
            .mockResolvedValueOnce(adminUser)
            .mockResolvedValueOnce(delegadoNutri)
            .mockResolvedValueOnce(delegadoNutri);

          await service.updateDoctorProfileById(
            'delegado-1',
            { council: ProfessionalCouncil.CRM, crm: '999', crmState: 'RJ' },
            'dono-1',
          );

          expect(mockDoctorProfileRepository.update).toHaveBeenCalledWith(
            'dp-d',
            expect.objectContaining({ council: ProfessionalCouncil.CRM }),
          );
        });

        it.each([
          ['trocar o próprio conselho', { council: ProfessionalCouncil.CRM }],
          ['deixar de ser profissional', { isDoctor: false }],
        ])(
          'não consegue %s por PATCH /users/collaborators/<id dele>',
          async (_caso, dto) => {
            mockUserRepository.findOneWithProfile
              .mockResolvedValueOnce(delegadoNutri)
              .mockResolvedValueOnce(delegadoNutri);

            await expect(
              service.updateCollaborator('delegado-1', dto, 'delegado-1'),
            ).rejects.toThrow(ForbiddenException);
            expect(mockDoctorProfileRepository.update).not.toHaveBeenCalled();
            expect(mockDoctorProfileRepository.delete).not.toHaveBeenCalled();
          },
        );

        it('admin delegado sem perfil não vira médico pelo PATCH /users/collaborators/<id dele>', async () => {
          const delegado = { ...delegadoNutri, doctorProfile: null };
          mockUserRepository.findOneWithProfile
            .mockResolvedValueOnce(delegado)
            .mockResolvedValueOnce(delegado);

          await expect(
            service.updateCollaborator(
              'delegado-1',
              {
                isDoctor: true,
                council: ProfessionalCouncil.CRM,
                crm: '999',
                crmState: 'RJ',
              },
              'delegado-1',
            ),
          ).rejects.toThrow(ForbiddenException);
          expect(mockDoctorProfileRepository.create).not.toHaveBeenCalled();
        });

        it('ainda edita outros dados próprios pelo PATCH /users/collaborators/<id dele>', async () => {
          mockUserRepository.findOneWithProfile
            .mockResolvedValueOnce(delegadoNutri)
            .mockResolvedValueOnce(delegadoNutri);
          mockUserRepository.findOne.mockResolvedValue(null);
          mockUserRepository.update.mockResolvedValue({ id: 'delegado-1' });

          await service.updateCollaborator(
            'delegado-1',
            { name: 'Novo nome', isDoctor: true },
            'delegado-1',
          );

          expect(mockUserRepository.update).toHaveBeenCalled();
        });
      });

      it('médico antigo com número vazio ainda troca só a especialidade', async () => {
        const legado = {
          id: 'dr-1',
          role: UserRole.COLLABORATOR,
          ownerId: 'dono-1',
          permissions: [],
          doctorProfile: {
            id: 'dp-1',
            council: ProfessionalCouncil.CRM,
            crm: '',
            crmState: '',
          },
        };
        mockUserRepository.findOneWithProfile
          .mockResolvedValueOnce(legado)
          .mockResolvedValueOnce(legado)
          .mockResolvedValueOnce(legado);

        await service.updateDoctorProfileById(
          'dr-1',
          { specialty: 'Ortopedia' },
          'dr-1',
        );

        expect(mockDoctorProfileRepository.update).toHaveBeenCalled();
      });
    });
  });
});
