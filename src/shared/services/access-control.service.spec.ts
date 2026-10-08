import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { UserRepository } from '../../database/repositories/user.repository';
import { DoctorProfileRepository } from '../../database/repositories/doctor-profile.repository';
import { UserDoctorAccessRepository } from '../../database/repositories/user-doctor-access.repository';
import { UserRole, UserStatus } from '../../database/entities/user.entity';
import { Permission } from '../permissions';

describe('AccessControlService', () => {
  let service: AccessControlService;
  let userRepository: { [K: string]: jest.Mock };
  let doctorProfileRepository: { [K: string]: jest.Mock };
  let userDoctorAccessRepository: { [K: string]: jest.Mock };

  beforeEach(async () => {
    userRepository = {
      findOneWithProfile: jest.fn(),
      findManyWithProfileByIds: jest.fn().mockResolvedValue([]),
      findDoctorsByOwnerId: jest.fn(),
      findOne: jest.fn(),
    };

    doctorProfileRepository = {};

    userDoctorAccessRepository = {
      findActiveByUserId: jest.fn(),
      findActiveByDoctorUserId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccessControlService,
        { provide: UserRepository, useValue: userRepository },
        { provide: DoctorProfileRepository, useValue: doctorProfileRepository },
        {
          provide: UserDoctorAccessRepository,
          useValue: userDoctorAccessRepository,
        },
      ],
    }).compile();

    service = module.get<AccessControlService>(AccessControlService);
  });

  // ─── getAccessibleDoctorIds ───

  describe('getAccessibleDoctorIds', () => {
    it('should return empty array for unknown user', async () => {
      userRepository.findOneWithProfile.mockResolvedValue(null);

      const result = await service.getAccessibleDoctorIds('unknown-id');

      expect(result).toEqual([]);
      expect(userRepository.findOneWithProfile).toHaveBeenCalledWith({
        id: 'unknown-id',
      });
    });

    it('should return all doctor IDs for ADMIN user', async () => {
      const adminUser = {
        id: 'admin-id',
        role: UserRole.ADMIN,
        ownerId: 'account-1',
      };
      userRepository.findOneWithProfile.mockResolvedValue(adminUser as any);
      userRepository.findDoctorsByOwnerId.mockResolvedValue([
        { id: 'doc-1' },
        { id: 'doc-2' },
        { id: 'doc-3' },
      ] as any);

      const result = await service.getAccessibleDoctorIds('admin-id');

      expect(result).toEqual(['doc-1', 'doc-2', 'doc-3']);
      expect(userRepository.findDoctorsByOwnerId).toHaveBeenCalledWith(
        'account-1',
      );
    });

    it('should include own user ID when user has doctorProfile', async () => {
      const doctorUser = {
        id: 'doctor-user-id',
        role: UserRole.COLLABORATOR,
        doctorProfile: { id: 'profile-1' },
      };
      userRepository.findOneWithProfile.mockResolvedValue(doctorUser as any);
      userDoctorAccessRepository.findActiveByUserId.mockResolvedValue([]);

      const result = await service.getAccessibleDoctorIds('doctor-user-id');

      expect(result).toContain('doctor-user-id');
    });

    it('should include linked doctor IDs from active accesses', async () => {
      const collaborator = {
        id: 'collab-id',
        role: UserRole.COLLABORATOR,
        doctorProfile: null,
      };
      userRepository.findOneWithProfile.mockResolvedValue(collaborator as any);
      userDoctorAccessRepository.findActiveByUserId.mockResolvedValue([
        { doctorUserId: 'linked-doc-1' },
        { doctorUserId: 'linked-doc-2' },
      ] as any);

      const result = await service.getAccessibleDoctorIds('collab-id');

      expect(result).toEqual(['linked-doc-1', 'linked-doc-2']);
    });

    it('should deduplicate when user is both doctor and has access link to self', async () => {
      const doctorUser = {
        id: 'doctor-user-id',
        role: UserRole.COLLABORATOR,
        doctorProfile: { id: 'profile-1' },
      };
      userRepository.findOneWithProfile.mockResolvedValue(doctorUser as any);
      userDoctorAccessRepository.findActiveByUserId.mockResolvedValue([
        { doctorUserId: 'doctor-user-id' },
        { doctorUserId: 'other-doc' },
      ] as any);

      const result = await service.getAccessibleDoctorIds('doctor-user-id');

      expect(result).toEqual(['doctor-user-id', 'other-doc']);
      // No duplicates
      expect(result.filter((id) => id === 'doctor-user-id')).toHaveLength(1);
    });

    it('should cache results and not re-query on the second call', async () => {
      const adminUser = {
        id: 'admin-id',
        role: UserRole.ADMIN,
        ownerId: 'account-1',
      };
      userRepository.findOneWithProfile.mockResolvedValue(adminUser as any);
      userRepository.findDoctorsByOwnerId.mockResolvedValue([
        { id: 'doc-1' },
      ] as any);

      const first = await service.getAccessibleDoctorIds('admin-id');
      const second = await service.getAccessibleDoctorIds('admin-id');

      expect(first).toEqual(['doc-1']);
      expect(second).toEqual(['doc-1']);
      // Só uma consulta ao banco graças ao cache.
      expect(userRepository.findOneWithProfile).toHaveBeenCalledTimes(1);
      expect(userRepository.findDoctorsByOwnerId).toHaveBeenCalledTimes(1);
    });

    it('should still use cache just before the 90s TTL expires', async () => {
      jest.useFakeTimers({ now: Date.now() });
      const adminUser = {
        id: 'admin-id',
        role: UserRole.ADMIN,
        ownerId: 'account-1',
      };
      userRepository.findOneWithProfile.mockResolvedValue(adminUser as any);
      userRepository.findDoctorsByOwnerId.mockResolvedValue([
        { id: 'doc-1' },
      ] as any);

      await service.getAccessibleDoctorIds('admin-id');
      jest.advanceTimersByTime(89_000);
      await service.getAccessibleDoctorIds('admin-id');

      expect(userRepository.findOneWithProfile).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    it('should re-query once the 90s TTL has elapsed', async () => {
      jest.useFakeTimers({ now: Date.now() });
      const adminUser = {
        id: 'admin-id',
        role: UserRole.ADMIN,
        ownerId: 'account-1',
      };
      userRepository.findOneWithProfile.mockResolvedValue(adminUser as any);
      userRepository.findDoctorsByOwnerId.mockResolvedValue([
        { id: 'doc-1' },
      ] as any);

      await service.getAccessibleDoctorIds('admin-id');
      jest.advanceTimersByTime(90_001);
      await service.getAccessibleDoctorIds('admin-id');

      expect(userRepository.findOneWithProfile).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });

    it('should re-query after invalidateAccessibleDoctors', async () => {
      const adminUser = {
        id: 'admin-id',
        role: UserRole.ADMIN,
        ownerId: 'account-1',
      };
      userRepository.findOneWithProfile.mockResolvedValue(adminUser as any);
      userRepository.findDoctorsByOwnerId.mockResolvedValue([
        { id: 'doc-1' },
      ] as any);

      await service.getAccessibleDoctorIds('admin-id');
      service.invalidateAccessibleDoctors('admin-id');
      await service.getAccessibleDoctorIds('admin-id');

      // Invalidação força nova consulta.
      expect(userRepository.findOneWithProfile).toHaveBeenCalledTimes(2);
    });
  });

  // ─── getAvailableDoctorsForCreation ───

  describe('getAvailableDoctorsForCreation', () => {
    it('should return empty array for unknown user', async () => {
      userRepository.findOneWithProfile.mockResolvedValue(null);

      const result = await service.getAvailableDoctorsForCreation('unknown-id');

      expect(result).toEqual([]);
    });

    it('should return full doctor list for ADMIN', async () => {
      const adminUser = {
        id: 'admin-id',
        role: UserRole.ADMIN,
        ownerId: 'account-1',
      };
      const doctors = [
        { id: 'doc-1', name: 'Doctor One' },
        { id: 'doc-2', name: 'Doctor Two' },
      ];
      userRepository.findOneWithProfile.mockResolvedValue(adminUser as any);
      userRepository.findDoctorsByOwnerId.mockResolvedValue(doctors as any);

      const result = await service.getAvailableDoctorsForCreation('admin-id');

      expect(result).toEqual(doctors);
      expect(userRepository.findDoctorsByOwnerId).toHaveBeenCalledWith(
        'account-1',
      );
    });

    it('should include self for non-admin doctor', async () => {
      const doctorUser = {
        id: 'doctor-id',
        role: UserRole.COLLABORATOR,
        doctorProfile: { id: 'profile-1' },
      };
      userRepository.findOneWithProfile.mockResolvedValue(doctorUser as any);
      userDoctorAccessRepository.findActiveByUserId.mockResolvedValue([]);

      const result = await service.getAvailableDoctorsForCreation('doctor-id');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('doctor-id');
    });

    it('should include linked doctors for non-admin with accesses', async () => {
      const collaborator = {
        id: 'collab-id',
        role: UserRole.COLLABORATOR,
        doctorProfile: null,
      };
      const linkedDoctor = {
        id: 'linked-doc-id',
        name: 'Linked Doctor',
        doctorProfile: { id: 'dp-1', council: 'CRM' },
      };
      userRepository.findOneWithProfile.mockResolvedValue(collaborator as any);
      userDoctorAccessRepository.findActiveByUserId.mockResolvedValue([
        { doctorUserId: 'linked-doc-id', doctor: { id: 'linked-doc-id' } },
      ] as any);
      // Carga única por IDs (substitui o N+1 de findOneWithProfile por vínculo).
      userRepository.findManyWithProfileByIds.mockResolvedValue([
        linkedDoctor,
      ] as any);

      const result = await service.getAvailableDoctorsForCreation('collab-id');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('linked-doc-id');
      expect(userRepository.findManyWithProfileByIds).toHaveBeenCalledWith([
        'linked-doc-id',
      ]);
    });

    it('should deduplicate doctors by ID', async () => {
      const doctorUser = {
        id: 'doctor-id',
        role: UserRole.COLLABORATOR,
        doctorProfile: { id: 'profile-1' },
      };
      userRepository.findOneWithProfile.mockResolvedValue(doctorUser as any);
      userDoctorAccessRepository.findActiveByUserId.mockResolvedValue([
        { doctorUserId: 'doctor-id', doctor: { id: 'doctor-id' } },
      ] as any);
      // Mesmo médico via vínculo — deve ser deduplicado com o "self".
      userRepository.findManyWithProfileByIds.mockResolvedValue([
        doctorUser,
      ] as any);

      const result = await service.getAvailableDoctorsForCreation('doctor-id');

      expect(result).toHaveLength(1);
    });
  });

  // ─── canAccessDoctor ───

  describe('canAccessDoctor', () => {
    it('should return true if doctorId is in accessible list', async () => {
      const user = {
        id: 'user-id',
        role: UserRole.COLLABORATOR,
        doctorProfile: null,
      };
      userRepository.findOneWithProfile.mockResolvedValue(user as any);
      userDoctorAccessRepository.findActiveByUserId.mockResolvedValue([
        { doctorUserId: 'target-doc' },
      ] as any);

      const result = await service.canAccessDoctor('user-id', 'target-doc');

      expect(result).toBe(true);
    });

    it('should return false if doctorId is not in accessible list', async () => {
      const user = {
        id: 'user-id',
        role: UserRole.COLLABORATOR,
        doctorProfile: null,
      };
      userRepository.findOneWithProfile.mockResolvedValue(user as any);
      userDoctorAccessRepository.findActiveByUserId.mockResolvedValue([
        { doctorUserId: 'other-doc' },
      ] as any);

      const result = await service.canAccessDoctor('user-id', 'target-doc');

      expect(result).toBe(false);
    });
  });

  // ─── getAccountId ───

  describe('getAccountId', () => {
    it('should return ownerId when user is found', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-id',
        ownerId: 'account-42',
      } as any);

      const result = await service.getAccountId('user-id');

      expect(result).toBe('account-42');
      expect(userRepository.findOne).toHaveBeenCalledWith({ id: 'user-id' });
    });

    it('should throw Error when user is not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.getAccountId('missing-id')).rejects.toThrow(
        'Usuário missing-id não encontrado',
      );
    });
  });

  // ─── assertIsPhysicianWithRegistry ───

  describe('assertIsPhysicianWithRegistry', () => {
    const comPerfil = (doctorProfile: object | null) =>
      userRepository.findOneWithProfile.mockResolvedValue({
        id: 'u-1',
        name: 'Karina Clínica',
        role: UserRole.COLLABORATOR,
        doctorProfile,
      } as any);

    it('libera médico com o número e a UF do CRM', async () => {
      comPerfil({ id: 'p-1', council: 'CRM', crm: '12345', crmState: 'RJ' });

      await expect(
        service.assertIsPhysicianWithRegistry(
          'u-1',
          'só médico',
          'indicar cirurgia',
        ),
      ).resolves.toBeUndefined();
    });

    it('médico sem número do CRM é recusado com orientação', async () => {
      comPerfil({ id: 'p-1', council: 'CRM', crm: '  ', crmState: 'RJ' });

      await expect(
        service.assertIsPhysicianWithRegistry(
          'u-1',
          'só médico',
          'indicar cirurgia',
        ),
      ).rejects.toThrow(
        'Preencha o número e a UF do CRM de Karina Clínica em Colaboradores antes de indicar cirurgia.',
      );
    });

    it('médico com número mas sem UF também é recusado', async () => {
      comPerfil({ id: 'p-1', council: 'CRM', crm: '12345', crmState: null });

      await expect(
        service.assertIsPhysicianWithRegistry(
          'u-1',
          'só médico',
          'indicar cirurgia',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('dentista (CRO) não indica cirurgia, mesmo com registro', async () => {
      comPerfil({ id: 'p-1', council: 'CRO', crm: '4321', crmState: 'RJ' });

      await expect(
        service.assertIsPhysicianWithRegistry(
          'u-1',
          'só médico',
          'indicar cirurgia',
        ),
      ).rejects.toThrow(new ForbiddenException('só médico'));
    });

    it('quem não é médico continua recusado com a mensagem informada', async () => {
      comPerfil({ id: 'p-1', council: 'COREN', crm: '999' });

      await expect(
        service.assertIsPhysicianWithRegistry(
          'u-1',
          'só médico',
          'indicar cirurgia',
        ),
      ).rejects.toThrow(new ForbiddenException('só médico'));
    });
  });

  // ─── canIndicateSurgery ───

  describe('canIndicateSurgery', () => {
    const comPerfil = (doctorProfile: object | null) =>
      userRepository.findOneWithProfile.mockResolvedValue({
        id: 'u-1',
        role: UserRole.COLLABORATOR,
        doctorProfile,
      } as any);

    it.each([
      [{ council: 'CRM', crm: '12345', crmState: 'RJ' }, true],
      [{ council: 'CRM', crm: '12345', crmState: null }, false],
      [{ council: 'CRM', crm: null, crmState: 'RJ' }, false],
      [{ council: 'CRO', crm: '4321', crmState: 'RJ' }, false],
      [null, false],
    ])('%j → %s', async (perfil, esperado) => {
      comPerfil(perfil);
      await expect(service.canIndicateSurgery('u-1')).resolves.toBe(esperado);
    });
  });

  // ─── assertCanIssueClinicalDocuments (CRM ou CRO) ───

  describe('assertCanIssueClinicalDocuments', () => {
    const comPerfil = (doctorProfile: object | null) =>
      userRepository.findOneWithProfile.mockResolvedValue({
        id: 'u-1',
        name: 'Bruno Dentista',
        role: UserRole.COLLABORATOR,
        doctorProfile,
      } as any);

    it.each(['CRM', 'CRO'])('libera %s', async (council) => {
      comPerfil({ council, crm: '1', crmState: 'RJ' });
      await expect(
        service.assertCanIssueClinicalDocuments('u-1'),
      ).resolves.toBeUndefined();
    });

    it.each(['CRN', 'CRP', 'COREN', 'OUTRO', undefined])(
      'recusa conselho %s com mensagem sem "apenas médicos (CRM)"',
      async (council) => {
        comPerfil({ council, crm: '1', crmState: 'RJ' });
        await expect(
          service.assertCanIssueClinicalDocuments('u-1'),
        ).rejects.toThrow(
          'Apenas médicos (CRM) e dentistas (CRO) podem emitir receita, atestado e pedido de exame.',
        );
      },
    );

    it('recusa quem não tem perfil profissional', async () => {
      comPerfil(null);
      await expect(
        service.assertCanIssueClinicalDocuments('u-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('não confere o registro (só o conselho): quem assina é conferido na emissão', async () => {
      comPerfil({ council: 'CRO', crm: null, crmState: null });

      await expect(
        service.assertCanIssueClinicalDocuments('u-1'),
      ).resolves.toBeUndefined();
    });
  });

  // ─── assertIsPhysician (MIG-02) ───

  describe('assertIsPhysician', () => {
    const comPerfil = (doctorProfile: object | null) =>
      userRepository.findOneWithProfile.mockResolvedValue({
        id: 'u-1',
        role: UserRole.COLLABORATOR,
        doctorProfile,
      } as any);

    it('libera perfil com conselho CRM', async () => {
      comPerfil({ id: 'p-1', council: 'CRM' });

      await expect(service.assertIsPhysician('u-1')).resolves.toBeUndefined();
    });

    it.each(['CRN', 'CRP', 'COREN', 'OUTRO'])(
      'bloqueia perfil de outro conselho (%s)',
      async (council) => {
        comPerfil({ id: 'p-1', council });

        await expect(service.assertIsPhysician('u-1')).rejects.toThrow(
          ForbiddenException,
        );
      },
    );

    // Estrito: perfil carregado sem a coluna não vira médico por omissão.
    it('bloqueia perfil sem council carregado', async () => {
      comPerfil({ id: 'p-1' });

      await expect(service.assertIsPhysician('u-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('bloqueia quem não tem perfil', async () => {
      comPerfil(null);

      await expect(service.assertIsPhysician('u-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('usa a mensagem informada', async () => {
      comPerfil({ id: 'p-1', council: 'CRN' });

      await expect(
        service.assertIsPhysician('u-1', 'mensagem própria'),
      ).rejects.toThrow('mensagem própria');
    });
  });

  // ─── assertIsDoctor ───

  describe('assertIsDoctor', () => {
    it('libera quem tem doctorProfile', async () => {
      userRepository.findOneWithProfile.mockResolvedValue({
        id: 'doctor-id',
        role: UserRole.COLLABORATOR,
        doctorProfile: { id: 'profile-1' },
      } as any);

      await expect(
        service.assertIsDoctor('doctor-id'),
      ).resolves.toBeUndefined();
    });

    it('bloqueia colaborador sem doctorProfile', async () => {
      userRepository.findOneWithProfile.mockResolvedValue({
        id: 'assistant-id',
        role: UserRole.COLLABORATOR,
        doctorProfile: null,
      } as any);

      await expect(service.assertIsDoctor('assistant-id')).rejects.toThrow(
        ForbiddenException,
      );
    });

    // Admin não é médico: quem administra a clínica sem doctorProfile também
    // não assina prontuário.
    it('bloqueia admin sem doctorProfile', async () => {
      userRepository.findOneWithProfile.mockResolvedValue({
        id: 'admin-id',
        role: UserRole.ADMIN,
        doctorProfile: null,
      } as any);

      await expect(service.assertIsDoctor('admin-id')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('bloqueia usuário inexistente', async () => {
      userRepository.findOneWithProfile.mockResolvedValue(null);

      await expect(service.assertIsDoctor('ghost')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ─── getEffectivePermissions ───

  describe('getEffectivePermissions', () => {
    it('deriva a permissão efetiva do usuário', async () => {
      userRepository.findOneWithProfile.mockResolvedValue({
        id: 'u-1',
        role: UserRole.COLLABORATOR,
        permissions: [Permission.AGENDA],
        doctorProfile: null,
      });

      await expect(service.getEffectivePermissions('u-1')).resolves.toEqual([
        Permission.AGENDA,
      ]);
    });

    it('devolve lista vazia para usuário inexistente', async () => {
      userRepository.findOneWithProfile.mockResolvedValue(null);

      await expect(service.getEffectivePermissions('sumiu')).resolves.toEqual(
        [],
      );
    });
  });
  // ─── getUsersWithAccessToDoctor ───

  describe('getUsersWithAccessToDoctor', () => {
    const medico = {
      id: 'doc-1',
      name: 'Dra. Ana',
      ownerId: 'owner-1',
      role: UserRole.COLLABORATOR,
      status: UserStatus.ACTIVE,
      permissions: [],
      doctorProfile: { id: 'dp-1' },
    };

    it('inclui o médico, os colaboradores vinculados e os admins da conta', async () => {
      userRepository.findByOwnerId = jest.fn().mockResolvedValue([
        medico,
        {
          id: 'admin-1',
          name: 'Dono',
          ownerId: 'owner-1',
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          permissions: [],
          doctorProfile: null,
        },
        {
          id: 'col-1',
          name: 'Secretária',
          ownerId: 'owner-1',
          role: UserRole.COLLABORATOR,
          status: UserStatus.ACTIVE,
          permissions: [Permission.SOLICITACOES],
          doctorProfile: null,
        },
        {
          id: 'col-2',
          name: 'Sem vínculo',
          ownerId: 'owner-1',
          role: UserRole.COLLABORATOR,
          status: UserStatus.ACTIVE,
          permissions: [Permission.SOLICITACOES],
          doctorProfile: null,
        },
      ] as any);
      userDoctorAccessRepository.findActiveByDoctorUserId.mockResolvedValue([
        { userId: 'col-1', doctorUserId: 'doc-1' },
      ] as any);

      const result = await service.getUsersWithAccessToDoctor(
        'doc-1',
        'owner-1',
      );

      expect(result.map((u) => u.id).sort()).toEqual([
        'admin-1',
        'col-1',
        'doc-1',
      ]);
    });

    it('profissional vinculado que não é CRM não ganha solicitações pelo perfil', async () => {
      userRepository.findByOwnerId = jest.fn().mockResolvedValue([
        medico,
        {
          id: 'nutri-1',
          name: 'Nutricionista',
          ownerId: 'owner-1',
          role: UserRole.COLLABORATOR,
          status: UserStatus.ACTIVE,
          permissions: [],
          doctorProfile: { id: 'dp-2', council: 'CRN' },
        },
      ] as any);
      userDoctorAccessRepository.findActiveByDoctorUserId.mockResolvedValue([
        { userId: 'nutri-1', doctorUserId: 'doc-1' },
      ] as any);

      const result = await service.getUsersWithAccessToDoctor(
        'doc-1',
        'owner-1',
      );

      expect(result.map((u) => u.id)).toEqual(['doc-1']);
    });

    it('exclui quem não tem a permissão de solicitações', async () => {
      userRepository.findByOwnerId = jest.fn().mockResolvedValue([
        medico,
        {
          id: 'col-agenda',
          name: 'Só agenda',
          ownerId: 'owner-1',
          role: UserRole.COLLABORATOR,
          status: UserStatus.ACTIVE,
          permissions: [Permission.AGENDA],
          doctorProfile: null,
        },
      ] as any);
      userDoctorAccessRepository.findActiveByDoctorUserId.mockResolvedValue([
        { userId: 'col-agenda', doctorUserId: 'doc-1' },
      ] as any);

      const result = await service.getUsersWithAccessToDoctor(
        'doc-1',
        'owner-1',
      );

      expect(result.map((u) => u.id)).toEqual(['doc-1']);
    });

    it('exclui usuários inativos', async () => {
      userRepository.findByOwnerId = jest.fn().mockResolvedValue([
        medico,
        {
          id: 'col-inativo',
          name: 'Desativado',
          ownerId: 'owner-1',
          role: UserRole.COLLABORATOR,
          status: UserStatus.INACTIVE,
          permissions: [Permission.SOLICITACOES],
          doctorProfile: null,
        },
      ] as any);
      userDoctorAccessRepository.findActiveByDoctorUserId.mockResolvedValue([
        { userId: 'col-inativo', doctorUserId: 'doc-1' },
      ] as any);

      const result = await service.getUsersWithAccessToDoctor(
        'doc-1',
        'owner-1',
      );

      expect(result.map((u) => u.id)).toEqual(['doc-1']);
    });
  });
});
