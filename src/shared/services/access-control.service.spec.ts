import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { UserRepository } from '../../database/repositories/user.repository';
import { DoctorProfileRepository } from '../../database/repositories/doctor-profile.repository';
import { UserDoctorAccessRepository } from '../../database/repositories/user-doctor-access.repository';
import { UserRole } from '../../database/entities/user.entity';

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
        doctorProfile: { id: 'dp-1' },
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
});
