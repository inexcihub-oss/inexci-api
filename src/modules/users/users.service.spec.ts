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
 * - PRD Reformulação Usuários e Permissões
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
    findManyByAdminId: jest.fn(),
    countDoctorsByAdminId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const mockEmailService = { send: jest.fn() };
  const mockTeamMemberRepository = { save: jest.fn() };
  const mockDoctorProfileRepository = {};
  const mockStorageService = { uploadFile: jest.fn(), deleteFile: jest.fn() };
  const mockSubscriptionPlanRepo = { findOne: jest.fn() };
  const mockWhatsappService = {
    sendDoctorWelcome: jest.fn(),
    sendPatientWelcome: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Instanciação direta — evita NestJS DI que requer DataSource real
    service = new UsersService(
      mockUserRepository as any,
      mockEmailService as any,
      mockTeamMemberRepository as any,
      mockDoctorProfileRepository as any,
      mockStorageService as any,
      mockSubscriptionPlanRepo as any,
      mockWhatsappService as any,
    );
  });

  it('deve estar definido', () => {
    expect(service).toBeDefined();
  });

  // ─── PRD: Usuários/Permissões — US-006: Controle de limite de médicos ───
  describe('canAddDoctor', () => {
    it('deve retornar false se admin não encontrado', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue(null);
      expect(await service.canAddDoctor('admin-1')).toBe(false);
    });

    it('deve retornar false se usuário não é admin', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'admin-1',
        is_admin: false,
      });
      expect(await service.canAddDoctor('admin-1')).toBe(false);
    });

    it('deve retornar false se admin não tem plano', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'admin-1',
        is_admin: true,
        subscription_plan: null,
      });
      expect(await service.canAddDoctor('admin-1')).toBe(false);
    });

    it('plano Básico (maxDoctors=1): admin é médico → não pode adicionar outro', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'admin-1',
        is_admin: true,
        is_doctor: true,
        subscription_plan: { max_doctors: 1 },
      });
      mockUserRepository.countDoctorsByAdminId.mockResolvedValue(0);

      // Admin médico já conta como 1, então 0 + 1 = 1 >= maxDoctors(1) → false
      expect(await service.canAddDoctor('admin-1')).toBe(false);
    });

    it('plano Básico (maxDoctors=1): admin NÃO é médico → pode adicionar 1', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'admin-1',
        is_admin: true,
        is_doctor: false,
        subscription_plan: { max_doctors: 1 },
      });
      mockUserRepository.countDoctorsByAdminId.mockResolvedValue(0);

      // 0 médicos vinculados, admin não é médico → 0 < 1 → true
      expect(await service.canAddDoctor('admin-1')).toBe(true);
    });

    it('plano Profissional (maxDoctors=10): 3 médicos + admin médico = 4 < 10 → true', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'admin-1',
        is_admin: true,
        is_doctor: true,
        subscription_plan: { max_doctors: 10 },
      });
      mockUserRepository.countDoctorsByAdminId.mockResolvedValue(3);

      // 3 + 1 (admin) = 4 < 10 → true
      expect(await service.canAddDoctor('admin-1')).toBe(true);
    });

    it('plano Profissional (maxDoctors=10): 9 médicos + admin médico = 10 → false', async () => {
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        id: 'admin-1',
        is_admin: true,
        is_doctor: true,
        subscription_plan: { max_doctors: 10 },
      });
      mockUserRepository.countDoctorsByAdminId.mockResolvedValue(9);

      // 9 + 1 = 10 >= 10 → false
      expect(await service.canAddDoctor('admin-1')).toBe(false);
    });
  });

  // ─── PRD: Usuários/Permissões — US-004: Gestão de colaboradores ─────────
  describe('findCollaborators', () => {
    it('deve retornar lista de colaboradores do admin', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'admin-1',
        is_admin: true,
      });
      mockUserRepository.findManyByAdminId.mockResolvedValue([
        { id: 'collab-1', name: 'Colaborador 1' },
      ]);

      const result = await service.findCollaborators('admin-1');

      expect(result.records).toHaveLength(1);
      expect(mockUserRepository.findManyByAdminId).toHaveBeenCalledWith(
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
        is_admin: false,
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
      is_admin: true,
      is_doctor: true,
      role: UserRole.DOCTOR,
    };

    beforeEach(() => {
      mockUserRepository.findOne
        .mockResolvedValueOnce(adminUser) // admin lookup
        .mockResolvedValueOnce(null); // email check
    });

    it('deve criar colaborador com role COLLABORATOR e status PENDING', async () => {
      mockUserRepository.create.mockResolvedValue({
        id: 'new-1',
        name: 'Novo',
        email: 'novo@email.com',
        role: UserRole.COLLABORATOR,
        status: UserStatus.PENDING,
        is_doctor: false,
        admin_id: 'admin-1',
      });

      const result = await service.createCollaborator(
        { name: 'Novo', email: 'novo@email.com' },
        'admin-1',
      );

      expect(mockUserRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: UserRole.COLLABORATOR,
          status: UserStatus.PENDING,
          is_admin: false,
          admin_id: 'admin-1',
        }),
      );
    });

    it('deve lançar BadRequestException para email duplicado', async () => {
      mockUserRepository.findOne
        .mockReset()
        .mockResolvedValueOnce(adminUser) // admin lookup
        .mockResolvedValueOnce({ id: 'existing' }); // email found

      await expect(
        service.createCollaborator(
          { name: 'Dup', email: 'existente@email.com' },
          'admin-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve verificar limite do plano ao criar colaborador médico (FR-9)', async () => {
      // Resetar mocks
      mockUserRepository.findOne
        .mockReset()
        .mockResolvedValueOnce(adminUser) // admin
        .mockResolvedValueOnce(null); // email check

      // canAddDoctor precisa do findOneWithProfile
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        ...adminUser,
        subscription_plan: { max_doctors: 1 },
      });
      mockUserRepository.countDoctorsByAdminId.mockResolvedValue(0);

      // Admin é médico e plano Básico (1 CRM) — não pode adicionar mais médico
      await expect(
        service.createCollaborator(
          {
            name: 'Dr. Novo',
            email: 'novo@email.com',
            is_doctor: true,
            crm: '123456',
            crm_state: 'SP',
          },
          'admin-1',
        ),
      ).rejects.toThrow('Limite de médicos do plano atingido');
    });

    it('deve enviar email de boas-vindas ao colaborador', async () => {
      mockUserRepository.create.mockResolvedValue({
        id: 'new-1',
        name: 'Novo',
        email: 'novo@email.com',
        role: UserRole.COLLABORATOR,
        is_doctor: false,
      });

      await service.createCollaborator(
        { name: 'Novo', email: 'novo@email.com' },
        'admin-1',
      );

      expect(mockEmailService.send).toHaveBeenCalledWith(
        'novo@email.com',
        expect.any(String),
        expect.stringContaining('Novo'),
      );
    });

    it('deve enviar WhatsApp de boas-vindas se colaborador é médico com telefone (PRD WhatsApp US-004)', async () => {
      mockUserRepository.findOne
        .mockReset()
        .mockResolvedValueOnce(adminUser) // admin
        .mockResolvedValueOnce(null); // email check

      // Permitir criar médico (plano com espaço)
      mockUserRepository.findOneWithProfile.mockResolvedValue({
        ...adminUser,
        is_doctor: false, // Admin não é médico → 1 vaga
        subscription_plan: { max_doctors: 1 },
      });
      mockUserRepository.countDoctorsByAdminId.mockResolvedValue(0);

      mockUserRepository.create.mockResolvedValue({
        id: 'new-1',
        name: 'Dr. João',
        email: 'joao@email.com',
        phone: '+5511999999999',
        role: UserRole.COLLABORATOR,
        is_doctor: true,
      });

      await service.createCollaborator(
        {
          name: 'Dr. João',
          email: 'joao@email.com',
          phone: '+5511999999999',
          is_doctor: true,
          crm: '123',
          crm_state: 'SP',
        },
        'admin-1',
      );

      expect(mockWhatsappService.sendDoctorWelcome).toHaveBeenCalledWith(
        '+5511999999999',
        'Dr. João',
        'joao@email.com',
      );
    });
  });

  describe('updateCollaborator', () => {
    it('deve lançar ForbiddenException se não é admin', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        is_admin: false,
      });

      await expect(
        service.updateCollaborator('collab-1', { name: 'Novo' }, 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar ForbiddenException se colaborador pertence a outro admin', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'admin-1', is_admin: true })
        .mockResolvedValueOnce({
          id: 'collab-1',
          admin_id: 'another-admin',
        });

      await expect(
        service.updateCollaborator('collab-1', { name: 'Novo' }, 'admin-1'),
      ).rejects.toThrow('Este colaborador não pertence à sua conta');
    });

    it('deve limpar campos médicos ao desmarcar is_doctor', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'admin-1', is_admin: true })
        .mockResolvedValueOnce({
          id: 'collab-1',
          admin_id: 'admin-1',
          is_doctor: true,
          crm: '123',
          crm_state: 'SP',
          specialty: 'Ortopedia',
        });

      mockUserRepository.update.mockResolvedValue({
        id: 'collab-1',
        is_doctor: false,
        crm: null,
      });

      await service.updateCollaborator(
        'collab-1',
        { is_doctor: false },
        'admin-1',
      );

      expect(mockUserRepository.update).toHaveBeenCalledWith(
        'collab-1',
        expect.objectContaining({
          is_doctor: false,
          crm: null,
          crm_state: null,
          specialty: null,
        }),
      );
    });
  });

  describe('deleteCollaborator', () => {
    it('deve deletar colaborador e retornar mensagem de sucesso', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'admin-1', is_admin: true })
        .mockResolvedValueOnce({ id: 'collab-1', admin_id: 'admin-1' });
      mockUserRepository.delete.mockResolvedValue(undefined);

      const result = await service.deleteCollaborator('collab-1', 'admin-1');

      expect(result).toEqual({ message: 'Colaborador removido com sucesso' });
      expect(mockUserRepository.delete).toHaveBeenCalledWith('collab-1');
    });

    it('deve lançar ForbiddenException se não é admin', async () => {
      mockUserRepository.findOne.mockResolvedValue({
        id: 'user-1',
        is_admin: false,
      });

      await expect(
        service.deleteCollaborator('collab-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar NotFoundException se colaborador não existe', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'admin-1', is_admin: true })
        .mockResolvedValueOnce(null);

      await expect(
        service.deleteCollaborator('invalid', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── PRD: Usuários/Permissões — US-005: Perfil médico ──────────────────
  describe('updateDoctorProfileById', () => {
    it('deve permitir médico editar próprio perfil', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({
          id: 'user-1',
          is_admin: false,
          is_doctor: true,
          role: UserRole.DOCTOR,
        })
        .mockResolvedValueOnce({
          id: 'user-1',
          is_doctor: true,
        });
      mockUserRepository.update.mockResolvedValue({
        id: 'user-1',
        crm: '999999',
      });

      const result = await service.updateDoctorProfileById(
        'user-1',
        { crm: '999999' },
        'user-1',
      );

      expect(mockUserRepository.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ crm: '999999' }),
      );
    });

    it('deve lançar BadRequestException se alvo não é médico', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({ id: 'admin-1', is_admin: true })
        .mockResolvedValueOnce({
          id: 'user-2',
          is_doctor: false,
          admin_id: 'admin-1',
        });

      await expect(
        service.updateDoctorProfileById('user-2', { crm: '123' }, 'admin-1'),
      ).rejects.toThrow('Este usuário não é médico');
    });

    it('deve lançar ForbiddenException se não é o próprio nem admin', async () => {
      mockUserRepository.findOne
        .mockResolvedValueOnce({
          id: 'other-user',
          is_admin: false,
          role: UserRole.COLLABORATOR,
        })
        .mockResolvedValueOnce({
          id: 'doctor-1',
          is_doctor: true,
          admin_id: 'real-admin',
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
});
