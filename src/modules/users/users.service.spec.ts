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

/**
 * Testes unitários focados no PRD:
 * - PRD Reformulação Usuários e Permissões v3
 * - PRD Comunicação WhatsApp (boas-vindas ao médico)
 *
 * Usa instanciação direta com mocks para evitar problemas de DI com repositórios
 * que dependem de DataSource/TypeORM no construtor.
 *
 * Convenção de fixtures desta suíte (pós-revisão da Tarefa 6):
 * - `dono-1` — dono real da conta (role ADMIN, id === ownerId === 'dono-1').
 * - `delegado-1` — admin delegado (role COLLABORATOR, ownerId: 'dono-1',
 *   permissions: [ADMINISTRACAO]). NUNCA usar `adminId: 'delegado-1'` no
 *   ATOR e depois tratá-lo como se fosse o dono — o pertencimento de um
 *   colaborador-alvo é sempre por `ownerId`, nunca por `adminId` (quem criou).
 * - `assertPodeGerirEquipe` agora devolve o usuário carregado (1 única
 *   consulta a `findOneWithProfile`), então os métodos de gestão de equipe
 *   NÃO fazem mais um `findOne` extra para o ator — só um `findOneWithProfile`.
 */
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
    getRepository: jest.fn(),
  };
  const mockMailService = {
    sendRaw: jest.fn(),
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
    findByUserId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    existsByUserId: jest.fn(),
  };
  const mockStorageService = {
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
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
    // `resetAllMocks` (não `clearAllMocks`): também limpa filas de
    // `mockResolvedValueOnce` e implementações de `mockImplementation` não
    // consumidas. Sem isso, um teste que monta 3 `mockResolvedValueOnce` mas
    // só consome 2 vaza a sobra para o PRÓXIMO teste (de qualquer describe,
    // já que os mocks são compartilhados no arquivo inteiro) — foi
    // exatamente esse vazamento que produziu fixtures "impossíveis" e testes
    // verdes por acidente numa revisão anterior desta suíte.
    jest.resetAllMocks();
    mockMailService.send.mockResolvedValue(undefined);
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'DASHBOARD_URL') return 'http://localhost:3000';
      return undefined;
    });

    // Instanciação direta — evita NestJS DI que requer DataSource real
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

  // ─── PRD v3: Gestão de colaboradores ─────────
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

    /**
     * Coerência de UI: o dono não é "gerenciável" (assertAlvoNaoEhDono
     * bloqueia toda ação sobre ele), então não pode aparecer na lista que
     * alimenta os botões de ação — senão a interface oferece um botão que
     * sempre falha com 403 para um admin delegado.
     */
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

    /**
     * Vazamento pré-existente: `userRepository.findByOwnerId` não define
     * `select`, então devolve `permissions` e `isPlatformAdmin` crus do
     * TypeORM. Cenário com coluna crua vazia e `doctorProfile` presente para
     * provar que o valor devolvido é a derivação (Agenda + Atendimento +
     * Solicitações), não a coluna repassada.
     */
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
          doctorProfile: { id: 'dp-1' },
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

  // ─── Vazamento de permissions/isPlatformAdmin em respostas HTTP ─────
  describe('getProfile', () => {
    /**
     * `permissions` cru e `isPlatformAdmin` não devem sair na resposta — mas
     * a permissão EFETIVA (derivada por `resolveEffectivePermissions`) deve.
     * Para provar que é a derivada (e não a coluna crua repassada), a coluna
     * vem vazia e o `doctorProfile` presente: só a derivação adiciona
     * Agenda/Atendimento/Solicitações nesse cenário.
     */
    it('expõe a permissão efetiva, mas não permissions cru, isPlatformAdmin nem password', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'user-1',
        role: UserRole.COLLABORATOR,
        password: 'hash-secreto',
        permissions: [],
        isPlatformAdmin: true,
        doctorProfile: { id: 'dp-1' },
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
  });

  describe('findCollaboratorById', () => {
    /**
     * Mesma lógica de `getProfile`: a coluna crua fica vazia e o
     * `doctorProfile` presente, então só a derivação explica Agenda +
     * Atendimento + Solicitações no resultado — prova que não é a coluna
     * crua repassada.
     */
    it('expõe a permissão efetiva do colaborador ao admin, sem permissions cru, isPlatformAdmin ou password', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'dono-1',
          role: UserRole.ADMIN,
          ownerId: 'dono-1',
        }) // assertPodeGerirEquipe
        .mockResolvedValueOnce({
          id: 'collab-1',
          role: UserRole.COLLABORATOR,
          ownerId: 'dono-1',
          password: 'hash-secreto',
          permissions: [],
          isPlatformAdmin: false,
          doctorProfile: { id: 'dp-1' },
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
      // I2: `grantedPermissions` precisa ser a coluna CRUA ([]), não a
      // efetiva — senão a tela de edição semeia o formulário com o bônus de
      // médico e regrava-o como se tivesse sido concedido de fato.
      expect(result.grantedPermissions).toEqual([]);
    });

    /**
     * C3: pertencimento é por `ownerId` (o tenant), não por `adminId` (quem
     * criou). O dono precisa ver colaboradores criados por um admin delegado.
     */
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
          adminId: 'delegado-1', // criado por outro admin, não pelo dono
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
      // assertPodeGerirEquipe consulta findOneWithProfile — role ADMIN já
      // basta para resolveEffectivePermissions liberar Administração. Como o
      // helper agora devolve o usuário direto, não há mais `findOne` extra
      // para o ator: o único `findOne` que sobra em createCollaborator é o
      // de telefone duplicado.
      mockUserRepository.findOneWithProfile.mockResolvedValue(adminUser);
      mockUserRepository.findOne.mockResolvedValue(null); // sem telefone duplicado
      mockUserRepository.findOneWithDeleted.mockResolvedValue(null); // sem email duplicado
      // Por padrão o admin não é médico — testes específicos sobrescrevem.
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

      // O serviço usa mailService.send (não sendRaw), verificar apenas que foi chamado
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

      // Deve ter criado o doctorProfile
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
      // Admin possui doctorProfile → é médico
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
      // Admin sem doctorProfile → não é médico
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

    /**
     * `userRepository.create` devolve exatamente o que foi persistido, sem
     * `select` — então `permissions` e `isPlatformAdmin` crus vinham direto
     * na resposta HTTP. O cenário usa um médico recém-criado (isDoctor+crm+
     * crmState) com `permissions` raw sem Agenda/Atendimento, para provar
     * que o valor devolvido é a EFETIVA (que soma o que o `doctor_profile`
     * concede), não a coluna crua repassada.
     */
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
    /**
     * O admin delegado tem role='collaborator' de propósito: mexer no role
     * quebraria a semântica de dono do tenant (ownerId = self.id) e o billing.
     * Quem autoriza é a permissão, não o role.
     */
    it('deixa colaborador com administração criar outro colaborador', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'delegado-1',
        role: UserRole.COLLABORATOR,
        ownerId: 'dono-1',
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });
      mockUserRepository.findOne.mockResolvedValue(null); // sem telefone duplicado
      mockUserRepository.findOneWithDeleted.mockResolvedValue(null);
      mockUserRepository.create.mockResolvedValue({ id: 'novo-1' });

      await expect(
        service.createCollaborator(
          { name: 'Ana', email: 'ana@x.com', phone: '11999999999' } as never,
          'delegado-1',
        ),
      ).resolves.toBeDefined();

      // O novo colaborador nasce no tenant do delegado (ownerId do dono),
      // não com o `ownerId` do próprio delegado (que não é dono de nada).
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

  // ─── C1: POST /users não pode virar porta para cunhar um segundo dono ───
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
      mockUserRepository.findOne.mockResolvedValue(null); // sem duplicidade de phone/email
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

      // O usuário criado herda `ownerId` de quem chamou (o tenant do
      // delegado), nunca `self.id` — gravar role=admin aqui deixaria um
      // ADMIN com ownerId de outra pessoa, quebrando a invariante de tenant.
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

  // ─── C2: updateProfileById — dono intocável + isolamento de tenant ───
  describe('updateProfileById', () => {
    it('permite que o usuário edite o próprio perfil sem checar Administração', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'user-1', ownerId: 'dono-1' }) // requesting
        .mockResolvedValueOnce({ id: 'user-1', ownerId: 'dono-1' }) // target (self)
        .mockResolvedValueOnce(null) // phone duplicado
        .mockResolvedValueOnce(null); // cpf duplicado
      mockUserRepository.update.mockResolvedValue({ id: 'user-1' });

      await expect(
        service.updateProfileById(
          'user-1',
          { name: 'Novo nome' } as never,
          'user-1',
        ),
      ).resolves.toBeDefined();
      // Self-edit não deve consultar findOneWithProfile (assertPodeGerirEquipe).
      expect(mockUserRepository.findOneWithProfile).not.toHaveBeenCalled();
    });

    it('deixa admin delegado editar colaborador do mesmo tenant', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'delegado-1', ownerId: 'dono-1' }) // requesting
        .mockResolvedValueOnce({ id: 'collab-1', ownerId: 'dono-1' }) // target
        .mockResolvedValueOnce(null) // phone duplicado
        .mockResolvedValueOnce(null); // cpf duplicado
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

    /**
     * C2: sem checagem de `ownerId`, o alvo podia estar em outro tenant. Um
     * delegado com Administração no seu próprio tenant não pode editar
     * usuários de OUTRA conta só porque tem a permissão em algum lugar.
     */
    it('bloqueia edição de usuário de outro tenant mesmo com Administração', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'delegado-1', ownerId: 'dono-1' }) // requesting
        .mockResolvedValueOnce({
          id: 'user-de-outra-conta',
          ownerId: 'outro-dono',
        }); // target
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

    /**
     * C2: o dono não é editável por ninguém além de si mesmo — nem por um
     * admin delegado com Administração. `phone` é a chave de identidade do
     * dono no assistente WhatsApp (`findOneByPhone`); reescrevê-lo via este
     * endpoint sequestraria o canal dele.
     */
    it('bloqueia edição do dono da conta por um admin delegado', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'delegado-1', ownerId: 'dono-1' }) // requesting
        .mockResolvedValueOnce({ id: 'dono-1', ownerId: 'dono-1' }); // target = dono
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
        }) // assertPodeGerirEquipe
        .mockResolvedValueOnce({ id: 'collab-1', ownerId: 'outro-dono' }); // alvo de outro tenant

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
        }) // assertPodeGerirEquipe
        .mockResolvedValueOnce({
          id: 'dono-1',
          ownerId: 'dono-1',
          adminId: 'delegado-1',
        }); // alvo é o dono

      await expect(
        service.updateCollaborator('dono-1', { name: 'Novo' }, 'delegado-1'),
      ).rejects.toThrow(
        'O dono da conta não pode ser alterado por outro usuário.',
      );
    });

    /**
     * C3: pertencimento é por `ownerId` (o tenant), não por `adminId` (quem
     * criou) — o dono precisa conseguir editar um colaborador que foi criado
     * por um admin delegado, e vice-versa. Antes, comparar por `adminId`
     * bloqueava esse caso e a feature de admin delegado não funcionava.
     */
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
          adminId: 'delegado-1', // criado por outro admin, não pelo dono
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
          adminId: 'dono-1', // criado pelo dono, não pelo delegado
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
        }) // assertPodeGerirEquipe
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

      // Deve ter deletado o doctorProfile
      expect(mockDoctorProfileRepository.delete).toHaveBeenCalledWith('dp-1');
    });

    /**
     * `undefined` significa "não mexi nas permissões" — o campo não pode
     * aparecer no objeto entregue ao repositório, senão sobrescreveria a
     * coluna com `undefined`/apagaria o que já estava gravado dependendo de
     * como o TypeORM trata a chave.
     */
    it('não altera permissions quando o campo é omitido', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'dono-1',
          role: UserRole.ADMIN,
          ownerId: 'dono-1',
        }) // assertPodeGerirEquipe
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

    /**
     * `[]` significa "retirei todas as permissões" — precisa ser gravado
     * explicitamente, diferente de simplesmente omitir o campo.
     */
    it('grava array vazio quando todas as permissões são retiradas', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'dono-1',
          role: UserRole.ADMIN,
          ownerId: 'dono-1',
        }) // assertPodeGerirEquipe
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
        }) // assertPodeGerirEquipe
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

    /**
     * `userRepository.update` devolve o resultado de `findOne`, cujo
     * `select` não inclui `permissions` — antes desta correção o admin que
     * acabava de conceder/revogar acesso não recebia confirmação nenhuma no
     * payload. Precisa devolver a EFETIVA (calculada sem outra ida ao
     * banco), não a coluna crua nem nada.
     */
    it('devolve a permissão efetiva após conceder permissões', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'dono-1',
          role: UserRole.ADMIN,
          ownerId: 'dono-1',
        }) // assertPodeGerirEquipe
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

    /**
     * `permissions` omitido não deve zerar a resposta: a efetiva precisa
     * refletir o que já estava gravado antes da chamada (carregado junto
     * com `collaborator`, sem outra ida ao banco).
     */
    it('devolve a permissão efetiva já existente quando permissions é omitido', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'dono-1',
          role: UserRole.ADMIN,
          ownerId: 'dono-1',
        }) // assertPodeGerirEquipe
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

    /**
     * `isDoctor: true` cria o `doctor_profile` na mesma chamada — a
     * permissão efetiva devolvida precisa já contar com Agenda/Atendimento/
     * Solicitações mesmo sem recarregar o colaborador do banco.
     */
    it('devolve a permissão efetiva já somando Agenda/Atendimento/Solicitações ao virar médico nesta chamada', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'dono-1',
          role: UserRole.ADMIN,
          ownerId: 'dono-1',
        }) // assertPodeGerirEquipe
        .mockResolvedValueOnce({
          id: 'collab-1',
          role: UserRole.COLLABORATOR,
          ownerId: 'dono-1',
          adminId: 'dono-1',
          permissions: [],
          doctorProfile: null, // ainda não é médico
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
      // I2: `grantedPermissions` continua vazio — o bônus de médico não foi
      // uma concessão gravada. Se um admin desmarcar "é médico" depois, o
      // colaborador deve voltar a ficar sem essas três, não retê-las.
      expect(result.grantedPermissions).toEqual([]);
    });

    /**
     * Tarefa 14 (revisão): o WhatsApp deriva `permissions` de caches em
     * memória (10 min / 5 min), diferente do guard HTTP que resolve a cada
     * request. Sem este evento, revogar acesso de um colaborador levaria até
     * 10 min para valer no assistente. Emitido só quando `permissions` ou
     * `isDoctor` de fato mudam — nunca em edições que não afetam acesso.
     */
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

  /**
   * Teste TDD da Tarefa 13 — grava e devolve as permissões do colaborador.
   * O exemplo original do brief esperava `[ATENDIMENTO, SOLICITACOES]` para
   * um médico; a regra de derivação mudou durante a execução do plano e hoje
   * `resolveEffectivePermissions` também concede Agenda a quem tem
   * `doctor_profile` (o médico agenda a própria consulta e marca como
   * realizada a partir da ficha) — ver `resolve-permissions.ts`.
   */
  describe('permissões do colaborador', () => {
    it('grava as permissões informadas na criação', async () => {
      // `findOne` aqui é só a checagem de telefone duplicado dentro de
      // `createCollaborator` — precisa devolver `null` (sem duplicidade), não
      // um usuário; quem resolve o ator (`assertPodeGerirEquipe`) é
      // `findOneWithProfile`.
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

    /** Sem nada informado, o colaborador nasce sem acesso a área nenhuma. */
    it('cria sem permissão quando o campo é omitido', async () => {
      // Mesmo motivo do teste anterior: `findOne` é a checagem de telefone.
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
        doctorProfile: { id: 'dp-1' },
      });

      const perfil = await service.getProfile('med-1');

      // Médico ganha Agenda, Atendimento e Solicitações por ter
      // `doctor_profile` — não apenas Atendimento e Solicitações.
      expect(perfil.permissions).toEqual([
        Permission.AGENDA,
        Permission.ATENDIMENTO,
        Permission.SOLICITACOES,
      ]);
    });
  });

  describe('deleteCollaborator', () => {
    beforeEach(() => {
      // assertPodeGerirEquipe consulta findOneWithProfile — por padrão o
      // ator é o dono da conta; o teste "não é admin" sobrescreve.
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

      // O phone deve ser substituído pela sentinela antes do delete
      expect(mockUserRepository.update).toHaveBeenCalledWith(
        collaboratorId,
        expect.objectContaining({
          phone: `DEL${collaboratorId.slice(0, 12)}`,
        }),
      );
    });

    it('após soft-delete, findOneByPhone com telefone original deve retornar null', async () => {
      // Simula: repositório só encontra usuário se phone bater exatamente
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

      // Após anonimização, o phone armazenado é a sentinela, não o original
      expect(storedPhone).not.toBe(originalPhone);
      expect(storedPhone).toBe(`DEL${collaboratorId.slice(0, 12)}`);
    });

    /**
     * Tarefa 14 (revisão 2): sem isto, um colaborador EXCLUÍDO continuava
     * operando pelo WhatsApp com a identidade e permissões antigas por até
     * 10 min (cache por telefone). O ponto crítico do teste: o evento tem
     * que carregar o telefone ORIGINAL — se carregasse a sentinela `DEL...`
     * (já gravada no banco quando o evento é emitido), a invalidação
     * limparia uma chave de cache que nunca existiu e a entrada real
     * continuaria contaminada.
     */
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
      // `UserRepository.update` no código real devolve `findOne` PÓS-update
      // (ver `BaseRepository.update`) — ou seja, já traria a sentinela de
      // volta. Mockar assim reproduz fielmente esse comportamento e torna o
      // teste capaz de pegar a regressão: se `deleteCollaborator` lesse o
      // telefone do retorno de `update(...)` em vez do `originalPhone`
      // capturado antes, o evento sairia com a sentinela.
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

    /**
     * C3: pertencimento por `ownerId`, não por `adminId`. Sem essa correção
     * o admin delegado nunca conseguia excluir um colaborador criado pelo
     * dono — que é a maioria dos colaboradores de qualquer conta.
     */
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
      // assertPodeGerirEquipe consulta findOneWithProfile — por padrão o
      // ator é admin da conta; o teste "não é admin" sobrescreve.
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

      // Importante: deve apagar TODOS os tokens (sem filtro `used`),
      // inclusive os já validados, para invalidar completamente o link antigo.
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

      // O delete deve ocorrer ANTES do create — ordem importa para garantir
      // que o novo token não seja apagado junto com os antigos.
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

    /**
     * Fronteira de segurança sem exceção: mesmo sendo um convite (não uma
     * alteração de dado sensível), o dono da conta não pode ser alvo desta
     * rota vindo de outro usuário — a lista do brief original deixou este
     * método de fora por engano.
     */
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

    /**
     * C3: pertencimento por `ownerId`. O admin delegado precisa reenviar
     * convite para colaborador pendente criado pelo dono.
     */
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

  // ─── Tarefa 6: proteção do dono da conta ──────────────────
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

    /**
     * C3: pertencimento por `ownerId`. Sem a correção, nem o dono conseguia
     * ativar/desativar ou redefinir senha de colaboradores criados por um
     * admin delegado (adminId apontava para o delegado, não para o dono).
     */
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

  /**
   * Tarefa 14 (revisão 2): desativar um colaborador precisa invalidar o
   * cache do WhatsApp na hora (ainda que isso, sozinho, não corte o acesso —
   * ver limitação documentada em `AiOrchestratorService.onUserAccessChanged`
   * e no relatório da tarefa).
   */
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
      find: jest.fn(),
      softDelete: jest.fn(),
    };

    beforeEach(() => {
      mockUserRepository.getRepository.mockReturnValue(getRepositoryMock);
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
      // I1: sem isso o teste passa mesmo se o `where` ainda filtrasse por
      // `adminId` (o mock de `find` devolveria os itens de qualquer jeito).
      // Travar o `where` é o que garante que o filtro real é por `ownerId`
      // do tenant do delegado, não por quem criou.
      expect(getRepositoryMock.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ownerId: 'dono-1',
            role: UserRole.COLLABORATOR,
          }),
        }),
      );
    });

    /**
     * Tarefa 14 (revisão 2): mesmo raciocínio de `deleteCollaborator`, mas
     * para cada item do lote — o `select` do `find` precisa trazer `phone`
     * (telefone ORIGINAL) para a invalidação usar a chave certa.
     */
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

      // O `select` precisa pedir `phone` — sem isso o campo viria `undefined`
      // do banco real e a invalidação não teria o que limpar.
      expect(getRepositoryMock.find).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({ phone: true }),
        }),
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

  // ─── PRD v3: Perfil médico (doctorProfile) ──────────────────
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
          doctorProfile: { id: 'dp-1' },
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
          doctorProfile: { id: 'dp-1' },
          adminId: 'real-admin',
        })
        .mockResolvedValueOnce({
          id: 'doctor-1',
          doctorProfile: { id: 'dp-1', signatureUrl: 'signatures/x.png' },
          // Permissão efetiva do médico-alvo: um colaborador com acesso
          // restrito à assinatura não deve recebê-la na resposta.
          permissions: [Permission.SOLICITACOES],
          isPlatformAdmin: true,
        });
      mockUserDoctorAccessRepository.findActiveByUserId.mockResolvedValue([
        { doctorUserId: 'doctor-1' },
      ]);

      const result = await service.updateDoctorProfileById(
        'doctor-1',
        { signatureImageUrl: 'signatures/x.png' },
        'collab-1',
      );

      expect(mockDoctorProfileRepository.update).toHaveBeenCalledWith(
        'dp-1',
        expect.objectContaining({ signatureUrl: 'signatures/x.png' }),
      );
      // Vazamento corrigido pós-revisão: colaborador só-assinatura não pode
      // ver permissions/isPlatformAdmin do médico-alvo na resposta.
      expect(result).not.toHaveProperty('permissions');
      expect(result).not.toHaveProperty('isPlatformAdmin');
    });

    it('deve barrar colaborador vinculado que tenta editar CRM', async () => {
      mockUserRepository.findOneWithProfile
        .mockResolvedValueOnce({
          id: 'collab-1',
          role: UserRole.COLLABORATOR,
        })
        .mockResolvedValueOnce({
          id: 'doctor-1',
          doctorProfile: { id: 'dp-1' },
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

    /**
     * C3 (2ª rodada): `isAdmin` comparava `target.adminId === requestingUserId`
     * — o admin delegado (role='collaborator' + Administração) nunca criou o
     * médico-alvo na maioria dos casos, então caía sempre no caminho
     * "colaborador vinculado, só assinatura" e nunca conseguia editar
     * CRM/especialidade de terceiro. Corrigido para permissão + `ownerId`.
     */
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
          adminId: 'dono-1', // médico criado pelo dono, não pelo delegado
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

  // ─── Tarefa 6: cabeçalho de terceiro passa a ser gateado por Administração ───
  describe('getDoctorHeaderByUserId — admin delegado', () => {
    /**
     * C3 (2ª rodada): fixture anterior usava `adminId: 'delegado-1'` — o
     * próprio ator como criador do alvo, o que nunca acontece quando o
     * cenário real é "médico foi criado pelo dono" (a maioria). Com essa
     * fixture bugada o teste ficava verde mesmo com
     * `target.adminId === requestingUserId` ainda no código (o bug do C3
     * neste caminho). Agora o alvo tem `adminId: 'dono-1'` — só pertencimento
     * por `ownerId` deve autorizar.
     */
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
        adminId: 'dono-1', // médico foi criado pelo dono, não pelo delegado
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
        adminId: 'delegado-1', // médico foi criado pelo delegado, não pelo dono
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

  // ─── Cabeçalho de Documentos ───
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

  // ─── changePassword ──────────────────────────────────────────────

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
});
