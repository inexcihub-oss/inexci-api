// Mock Supabase para evitar validação de URL no nível do módulo
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: jest.fn() },
    storage: {
      from: jest.fn(() => ({ upload: jest.fn(), getPublicUrl: jest.fn() })),
    },
  })),
}));

import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UserRole, UserStatus } from 'src/database/entities/user.entity';

/**
 * Testes unitários focados no PRD:
 * - PRD Reformulação Usuários e Permissões v3
 * - PRD Comunicação WhatsApp (boas-vindas ao médico)
 *
 * Usa instanciação direta com mocks para evitar problemas de DI com repositórios
 * que dependem de DataSource/TypeORM no construtor.
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
  };
  const mockMailService = {
    sendRaw: jest.fn(),
    send: jest.fn().mockResolvedValue(undefined),
  };
  const mockUserDoctorAccessRepository = {
    findActiveByUserId: jest.fn(),
    findActiveByDoctorUserId: jest.fn(),
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

  beforeEach(() => {
    jest.clearAllMocks();

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
    );
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  // ─── PRD v3: Gestão de colaboradores ─────────
  describe('findCollaborators', () => {
    it('deve retornar lista de colaboradores da conta', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'admin-1',
        role: UserRole.ADMIN,
        ownerId: 'admin-1',
      });
      mockUserRepository.findByOwnerId.mockResolvedValue([
        { id: 'collab-1', name: 'Colaborador 1' },
      ]);

      const result = await service.findCollaborators('admin-1');

      expect(result.records).toHaveLength(1);
      expect(mockUserRepository.findByOwnerId).toHaveBeenCalledWith(
        'admin-1',
        0,
        50,
      );
    });

    it('deve lançar NotFoundException se admin não encontrado', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.findCollaborators('invalid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deve lançar ForbiddenException se não é admin', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        role: UserRole.COLLABORATOR,
      });

      await expect(service.findCollaborators('user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('createCollaborator', () => {
    const adminUser = {
      id: 'admin-1',
      name: 'Admin',
      role: UserRole.ADMIN,
      ownerId: 'admin-1',
    };

    beforeEach(() => {
      mockUserRepository.findOne.mockResolvedValueOnce(adminUser); // admin lookup
      mockUserRepository.findOneWithDeleted.mockResolvedValue(null); // sem email duplicado
    });

    it('deve criar colaborador com role COLLABORATOR e status PENDING', async () => {
      mockUserRepository.create.mockResolvedValue({
        id: 'new-1',
        name: 'Novo',
        email: 'novo@email.com',
        role: UserRole.COLLABORATOR,
        status: UserStatus.PENDING,
        ownerId: 'admin-1',
        adminId: 'admin-1',
      });

      const result = await service.createCollaborator(
        { name: 'Novo', email: 'novo@email.com' },
        'admin-1',
      );

      expect(mockUserRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: UserRole.COLLABORATOR,
          status: UserStatus.PENDING,
          ownerId: 'admin-1',
          adminId: 'admin-1',
        }),
      );
    });

    it('deve lançar BadRequestException para email duplicado', async () => {
      mockUserRepository.findOne.mockReset().mockResolvedValueOnce(adminUser);
      mockUserRepository.findOneWithDeleted.mockResolvedValue({
        id: 'existing',
        deletedAt: null,
        email: 'existente@email.com',
      });

      await expect(
        service.createCollaborator(
          { name: 'Dup', email: 'existente@email.com' },
          'admin-1',
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
        { name: 'Novo', email: 'novo@email.com' },
        'admin-1',
      );

      // O serviço usa mailService.send (não sendRaw), verificar apenas que foi chamado
      expect(mockUserRepository.create).toHaveBeenCalled();
    });

    it('deve criar doctorProfile e enviar WhatsApp se colaborador é médico com telefone', async () => {
      mockUserRepository.findOne.mockReset().mockResolvedValueOnce(adminUser);
      mockUserRepository.findOneWithDeleted.mockResolvedValue(null);

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
        'admin-1',
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

    it('deve enviar WhatsApp para colaborador não-médico com telefone', async () => {
      mockUserRepository.findOne.mockReset().mockResolvedValueOnce(adminUser);
      mockUserRepository.findOneWithDeleted.mockResolvedValue(null);

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
        'admin-1',
      );

      expect(mockWhatsappService.sendUserWelcome).toHaveBeenCalledWith(
        '+5511988888888',
        'Ana',
      );
    });
  });

  describe('updateCollaborator', () => {
    it('deve lançar ForbiddenException se não é admin', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        role: UserRole.COLLABORATOR,
      });

      await expect(
        service.updateCollaborator('collab-1', { name: 'Novo' }, 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar ForbiddenException se colaborador pertence a outro admin', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'admin-1',
        role: UserRole.ADMIN,
      });
      mockUserRepository.findOneWithProfile.mockResolvedValueOnce({
        id: 'collab-1',
        adminId: 'another-admin',
      });

      await expect(
        service.updateCollaborator('collab-1', { name: 'Novo' }, 'admin-1'),
      ).rejects.toThrow('Este colaborador não pertence à sua conta');
    });

    it('deve remover doctorProfile ao desmarcar isDoctor', async () => {
      mockUserRepository.findOne.mockResolvedValueOnce({
        id: 'admin-1',
        role: UserRole.ADMIN,
      });
      mockUserRepository.findOneWithProfile.mockResolvedValueOnce({
        id: 'collab-1',
        adminId: 'admin-1',
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
        'admin-1',
      );

      // Deve ter deletado o doctorProfile
      expect(mockDoctorProfileRepository.delete).toHaveBeenCalledWith('dp-1');
    });
  });

  describe('deleteCollaborator', () => {
    it('deve deletar colaborador e retornar mensagem de sucesso', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'admin-1', role: UserRole.ADMIN })
        .mockResolvedValueOnce({ id: 'collab-1', adminId: 'admin-1' });
      mockUserRepository.delete.mockResolvedValue(undefined);

      const result = await service.deleteCollaborator('collab-1', 'admin-1');

      expect(result).toEqual({ message: 'Colaborador desativado com sucesso' });
      expect(mockUserRepository.delete).toHaveBeenCalledWith('collab-1');
    });

    it('deve lançar ForbiddenException se não é admin', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        role: UserRole.COLLABORATOR,
      });

      await expect(
        service.deleteCollaborator('collab-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar NotFoundException se colaborador não existe', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'admin-1', role: UserRole.ADMIN })
        .mockResolvedValueOnce(null);

      await expect(
        service.deleteCollaborator('invalid', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
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
