import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { UserDoctorAccessService } from './user-doctor-access.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { UserDoctorAccessRepository } from 'src/database/repositories/user-doctor-access.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { UserRole } from 'src/database/entities/user.entity';
import { Permission } from 'src/shared/permissions';

const ADMIN_ID = 'admin-id';
const USER_ID = 'user-id';
const DOCTOR_ID = 'doctor-id';
const ACCOUNT_ID = 'account-id';

function makeAdmin(overrides = {}) {
  return {
    id: ADMIN_ID,
    role: UserRole.ADMIN,
    ownerId: ACCOUNT_ID,
    ...overrides,
  };
}

function makeUser(overrides = {}) {
  return {
    id: USER_ID,
    role: UserRole.COLLABORATOR,
    ownerId: ACCOUNT_ID,
    ...overrides,
  };
}

describe('UserDoctorAccessService', () => {
  let service: UserDoctorAccessService;
  let userRepository: jest.Mocked<Partial<UserRepository>>;
  let userDoctorAccessRepository: jest.Mocked<
    Partial<UserDoctorAccessRepository>
  >;
  let doctorProfileRepository: jest.Mocked<Partial<DoctorProfileRepository>>;
  let accessControlService: jest.Mocked<Partial<AccessControlService>>;

  beforeEach(async () => {
    userRepository = {
      findOne: jest.fn(),
      findOneWithProfile: jest.fn(),
    };

    accessControlService = {
      invalidateAccessibleDoctors: jest.fn(),
    };

    userDoctorAccessRepository = {
      findAllByUserId: jest.fn(),
      replaceDoctorsForUser: jest.fn(),
    };

    doctorProfileRepository = {
      existsByUserId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserDoctorAccessService,
        { provide: UserRepository, useValue: userRepository },
        {
          provide: UserDoctorAccessRepository,
          useValue: userDoctorAccessRepository,
        },
        { provide: DoctorProfileRepository, useValue: doctorProfileRepository },
        { provide: AccessControlService, useValue: accessControlService },
      ],
    }).compile();

    service = module.get<UserDoctorAccessService>(UserDoctorAccessService);
  });

  describe('admin validation', () => {
    it('throws NotFoundException when admin user does not exist', async () => {
      (userRepository.findOneWithProfile as jest.Mock).mockResolvedValueOnce(
        null,
      );

      await expect(service.getAccessForUser(USER_ID, ADMIN_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when caller is not admin', async () => {
      (userRepository.findOneWithProfile as jest.Mock).mockResolvedValueOnce(
        makeAdmin({ role: UserRole.COLLABORATOR }),
      );

      await expect(service.getAccessForUser(USER_ID, ADMIN_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows a delegated admin (role=collaborator + Administração) to manage access', async () => {
      const delegatedAdmin = makeAdmin({
        role: UserRole.COLLABORATOR,
        permissions: [Permission.ADMINISTRACAO],
        doctorProfile: null,
      });
      const user = makeUser();

      (userRepository.findOneWithProfile as jest.Mock).mockResolvedValueOnce(
        delegatedAdmin,
      );
      (userRepository.findOne as jest.Mock).mockResolvedValueOnce(user);
      (
        userDoctorAccessRepository.findAllByUserId as jest.Mock
      ).mockResolvedValueOnce([]);

      await expect(
        service.getAccessForUser(USER_ID, ADMIN_ID),
      ).resolves.toEqual({ records: [] });
    });
  });

  describe('getAccessForUser', () => {
    it('returns accesses for a user in the same account', async () => {
      const admin = makeAdmin();
      const user = makeUser();
      const accesses = [{ id: '1' }];

      (userRepository.findOneWithProfile as jest.Mock).mockResolvedValueOnce(
        admin,
      );
      (userRepository.findOne as jest.Mock).mockResolvedValueOnce(user);
      (
        userDoctorAccessRepository.findAllByUserId as jest.Mock
      ).mockResolvedValueOnce(accesses);

      const result = await service.getAccessForUser(USER_ID, ADMIN_ID);

      expect(result).toEqual({ records: accesses });
      expect(userDoctorAccessRepository.findAllByUserId).toHaveBeenCalledWith(
        USER_ID,
      );
    });

    it('throws ForbiddenException when user belongs to a different account', async () => {
      const admin = makeAdmin();
      const foreignUser = makeUser({ ownerId: 'other-account' });

      (userRepository.findOneWithProfile as jest.Mock).mockResolvedValueOnce(
        admin,
      );
      (userRepository.findOne as jest.Mock).mockResolvedValueOnce(foreignUser);

      await expect(service.getAccessForUser(USER_ID, ADMIN_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when the target user does not exist', async () => {
      const admin = makeAdmin();

      (userRepository.findOneWithProfile as jest.Mock).mockResolvedValueOnce(
        admin,
      );
      (userRepository.findOne as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.getAccessForUser(USER_ID, ADMIN_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('setAccess', () => {
    it('redefine os vínculos numa operação só e invalida o cache de acesso', async () => {
      const admin = makeAdmin();
      const user = makeUser();
      const doctorUser = makeUser({ id: DOCTOR_ID });
      const updatedAccesses = [{ id: 'access-2', doctorUserId: DOCTOR_ID }];

      (userRepository.findOneWithProfile as jest.Mock).mockResolvedValueOnce(
        admin,
      );
      (userRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce(doctorUser);
      (
        doctorProfileRepository.existsByUserId as jest.Mock
      ).mockResolvedValueOnce(true);
      (
        userDoctorAccessRepository.replaceDoctorsForUser as jest.Mock
      ).mockResolvedValueOnce(updatedAccesses);

      const result = await service.setAccess(USER_ID, [DOCTOR_ID], ADMIN_ID);

      expect(
        userDoctorAccessRepository.replaceDoctorsForUser,
      ).toHaveBeenCalledWith(USER_ID, [DOCTOR_ID], ADMIN_ID);
      expect(result).toEqual({ records: updatedAccesses });
      expect(
        accessControlService.invalidateAccessibleDoctors,
      ).toHaveBeenCalledWith(USER_ID);
    });

    it('throws BadRequestException when a doctorUserId has no doctorProfile', async () => {
      const admin = makeAdmin();
      const user = makeUser();
      const nonDoctor = makeUser({ id: DOCTOR_ID });

      (userRepository.findOneWithProfile as jest.Mock).mockResolvedValueOnce(
        admin,
      );
      (userRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce(nonDoctor);

      (
        doctorProfileRepository.existsByUserId as jest.Mock
      ).mockResolvedValueOnce(false);

      await expect(
        service.setAccess(USER_ID, [DOCTOR_ID], ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
      expect(
        userDoctorAccessRepository.replaceDoctorsForUser,
      ).not.toHaveBeenCalled();
    });
  });
});
