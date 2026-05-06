import { Test, TestingModule } from '@nestjs/testing';
import { AccessControlService } from './access-control.service';
import { UserRepository } from '../../database/repositories/user.repository';
import { DoctorProfileRepository } from '../../database/repositories/doctor-profile.repository';
import { UserDoctorAccessRepository } from '../../database/repositories/user-doctor-access.repository';
import { UserRole } from '../../database/entities/user.entity';

describe('AccessControlService', () => {
  let service: AccessControlService;
  let userRepository: jest.Mocked<Partial<UserRepository>>;
  let doctorProfileRepository: jest.Mocked<Partial<DoctorProfileRepository>>;
  let userDoctorAccessRepository: jest.Mocked<
    Partial<UserDoctorAccessRepository>
  >;

  beforeEach(async () => {
    userRepository = {
      findOneWithProfile: jest.fn(),
      findDoctorsByAccountId: jest.fn(),
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
        account_id: 'account-1',
      };
      userRepository.findOneWithProfile.mockResolvedValue(adminUser as any);
      userRepository.findDoctorsByAccountId.mockResolvedValue([
        { id: 'doc-1' },
        { id: 'doc-2' },
        { id: 'doc-3' },
      ] as any);

      const result = await service.getAccessibleDoctorIds('admin-id');

      expect(result).toEqual(['doc-1', 'doc-2', 'doc-3']);
      expect(userRepository.findDoctorsByAccountId).toHaveBeenCalledWith(
        'account-1',
      );
    });

    it('should include own user ID when user has doctor_profile', async () => {
      const doctorUser = {
        id: 'doctor-user-id',
        role: UserRole.COLLABORATOR,
        doctor_profile: { id: 'profile-1' },
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
        doctor_profile: null,
      };
      userRepository.findOneWithProfile.mockResolvedValue(collaborator as any);
      userDoctorAccessRepository.findActiveByUserId.mockResolvedValue([
        { doctor_user_id: 'linked-doc-1' },
        { doctor_user_id: 'linked-doc-2' },
      ] as any);

      const result = await service.getAccessibleDoctorIds('collab-id');

      expect(result).toEqual(['linked-doc-1', 'linked-doc-2']);
    });

    it('should deduplicate when user is both doctor and has access link to self', async () => {
      const doctorUser = {
        id: 'doctor-user-id',
        role: UserRole.COLLABORATOR,
        doctor_profile: { id: 'profile-1' },
      };
      userRepository.findOneWithProfile.mockResolvedValue(doctorUser as any);
      userDoctorAccessRepository.findActiveByUserId.mockResolvedValue([
        { doctor_user_id: 'doctor-user-id' },
        { doctor_user_id: 'other-doc' },
      ] as any);

      const result = await service.getAccessibleDoctorIds('doctor-user-id');

      expect(result).toEqual(['doctor-user-id', 'other-doc']);
      // No duplicates
      expect(result.filter((id) => id === 'doctor-user-id')).toHaveLength(1);
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
        account_id: 'account-1',
      };
      const doctors = [
        { id: 'doc-1', name: 'Doctor One' },
        { id: 'doc-2', name: 'Doctor Two' },
      ];
      userRepository.findOneWithProfile.mockResolvedValue(adminUser as any);
      userRepository.findDoctorsByAccountId.mockResolvedValue(doctors as any);

      const result = await service.getAvailableDoctorsForCreation('admin-id');

      expect(result).toEqual(doctors);
      expect(userRepository.findDoctorsByAccountId).toHaveBeenCalledWith(
        'account-1',
      );
    });

    it('should include self for non-admin doctor', async () => {
      const doctorUser = {
        id: 'doctor-id',
        role: UserRole.COLLABORATOR,
        doctor_profile: { id: 'profile-1' },
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
        doctor_profile: null,
      };
      const linkedDoctor = {
        id: 'linked-doc-id',
        name: 'Linked Doctor',
        doctor_profile: { id: 'dp-1' },
      };
      userRepository.findOneWithProfile
        .mockResolvedValueOnce(collaborator as any) // initial call
        .mockResolvedValueOnce(linkedDoctor as any); // loading linked doctor
      userDoctorAccessRepository.findActiveByUserId.mockResolvedValue([
        { doctor_user_id: 'linked-doc-id', doctor: { id: 'linked-doc-id' } },
      ] as any);

      const result = await service.getAvailableDoctorsForCreation('collab-id');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('linked-doc-id');
    });

    it('should deduplicate doctors by ID', async () => {
      const doctorUser = {
        id: 'doctor-id',
        role: UserRole.COLLABORATOR,
        doctor_profile: { id: 'profile-1' },
      };
      userRepository.findOneWithProfile
        .mockResolvedValueOnce(doctorUser as any) // initial call
        .mockResolvedValueOnce(doctorUser as any); // loading same doctor via access
      userDoctorAccessRepository.findActiveByUserId.mockResolvedValue([
        { doctor_user_id: 'doctor-id', doctor: { id: 'doctor-id' } },
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
        doctor_profile: null,
      };
      userRepository.findOneWithProfile.mockResolvedValue(user as any);
      userDoctorAccessRepository.findActiveByUserId.mockResolvedValue([
        { doctor_user_id: 'target-doc' },
      ] as any);

      const result = await service.canAccessDoctor('user-id', 'target-doc');

      expect(result).toBe(true);
    });

    it('should return false if doctorId is not in accessible list', async () => {
      const user = {
        id: 'user-id',
        role: UserRole.COLLABORATOR,
        doctor_profile: null,
      };
      userRepository.findOneWithProfile.mockResolvedValue(user as any);
      userDoctorAccessRepository.findActiveByUserId.mockResolvedValue([
        { doctor_user_id: 'other-doc' },
      ] as any);

      const result = await service.canAccessDoctor('user-id', 'target-doc');

      expect(result).toBe(false);
    });
  });

  // ─── getAccountId ───

  describe('getAccountId', () => {
    it('should return account_id when user is found', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-id',
        account_id: 'account-42',
      } as any);

      const result = await service.getAccountId('user-id');

      expect(result).toBe('account-42');
      expect(userRepository.findOne).toHaveBeenCalledWith({ id: 'user-id' });
    });

    it('should throw Error when user is not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.getAccountId('missing-id')).rejects.toThrow(
        'User missing-id not found',
      );
    });
  });
});
