import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { UserDoctorAccessService } from './user-doctor-access.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { UserDoctorAccessRepository } from 'src/database/repositories/user-doctor-access.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { UserRole } from 'src/database/entities/user.entity';
import { UserDoctorAccessStatus } from 'src/database/entities/user-doctor-access.entity';

const ADMIN_ID = 'admin-id';
const USER_ID = 'user-id';
const DOCTOR_ID = 'doctor-id';
const ACCOUNT_ID = 'account-id';

function makeAdmin(overrides = {}) {
  return {
    id: ADMIN_ID,
    role: UserRole.ADMIN,
    account_id: ACCOUNT_ID,
    ...overrides,
  };
}

function makeUser(overrides = {}) {
  return {
    id: USER_ID,
    role: UserRole.COLLABORATOR,
    account_id: ACCOUNT_ID,
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
  let dataSource: jest.Mocked<Partial<DataSource>>;

  beforeEach(async () => {
    userRepository = {
      findOne: jest.fn(),
    };

    userDoctorAccessRepository = {
      findAllByUserId: jest.fn(),
      findByAccountId: jest.fn(),
      upsert: jest.fn(),
      deactivate: jest.fn(),
    };

    doctorProfileRepository = {
      existsByUserId: jest.fn(),
    };

    // dataSource.transaction executes the callback with a mock manager
    dataSource = {
      transaction: jest.fn().mockImplementation((cb) => cb({})),
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
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<UserDoctorAccessService>(UserDoctorAccessService);
  });

  // ── validateAdmin ──────────────────────────────────────────────────────────

  describe('admin validation', () => {
    it('throws NotFoundException when admin user does not exist', async () => {
      (userRepository.findOne as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.getAccessList(ADMIN_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when caller is not admin', async () => {
      (userRepository.findOne as jest.Mock).mockResolvedValueOnce(
        makeAdmin({ role: UserRole.COLLABORATOR }),
      );

      await expect(service.getAccessList(ADMIN_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── getAccessList ──────────────────────────────────────────────────────────

  describe('getAccessList', () => {
    it('returns all access records for the admin account', async () => {
      const admin = makeAdmin();
      const accesses = [{ id: '1' }, { id: '2' }];
      (userRepository.findOne as jest.Mock).mockResolvedValueOnce(admin);
      (userDoctorAccessRepository.findByAccountId as jest.Mock).mockResolvedValueOnce(
        accesses,
      );

      const result = await service.getAccessList(ADMIN_ID);

      expect(result).toEqual({ records: accesses });
      expect(userDoctorAccessRepository.findByAccountId).toHaveBeenCalledWith(
        ACCOUNT_ID,
      );
    });
  });

  // ── getAccessForUser ───────────────────────────────────────────────────────

  describe('getAccessForUser', () => {
    it('returns accesses for a user in the same account', async () => {
      const admin = makeAdmin();
      const user = makeUser();
      const accesses = [{ id: '1' }];

      (userRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(admin)
        .mockResolvedValueOnce(user);
      (userDoctorAccessRepository.findAllByUserId as jest.Mock).mockResolvedValueOnce(
        accesses,
      );

      const result = await service.getAccessForUser(USER_ID, ADMIN_ID);

      expect(result).toEqual({ records: accesses });
      expect(userDoctorAccessRepository.findAllByUserId).toHaveBeenCalledWith(
        USER_ID,
      );
    });

    it('throws ForbiddenException when user belongs to a different account', async () => {
      const admin = makeAdmin();
      const foreignUser = makeUser({ account_id: 'other-account' });

      (userRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(admin)
        .mockResolvedValueOnce(foreignUser);

      await expect(
        service.getAccessForUser(USER_ID, ADMIN_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the target user does not exist', async () => {
      const admin = makeAdmin();

      (userRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(admin)
        .mockResolvedValueOnce(null);

      await expect(
        service.getAccessForUser(USER_ID, ADMIN_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── setAccess ──────────────────────────────────────────────────────────────

  describe('setAccess', () => {
    it('deactivates removed doctors and upserts new ones', async () => {
      const admin = makeAdmin();
      const user = makeUser();
      const doctorUser = makeUser({ id: DOCTOR_ID });
      const existingAccess = { doctor_user_id: 'old-doctor', id: 'access-1' };
      const updatedAccesses = [{ id: 'access-2', doctor_user_id: DOCTOR_ID }];

      // validateAdmin + validateUserInAccount (for userId) + validateDoctorUser (findOne + existsByUserId)
      (userRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(admin) // validateAdmin
        .mockResolvedValueOnce(user) // validateUserInAccount(userId)
        .mockResolvedValueOnce(doctorUser); // validateUserInAccount(doctorId inside validateDoctorUser)

      (doctorProfileRepository.existsByUserId as jest.Mock).mockResolvedValueOnce(
        true,
      );

      (userDoctorAccessRepository.findAllByUserId as jest.Mock)
        .mockResolvedValueOnce([existingAccess]) // existing accesses inside transaction
        .mockResolvedValueOnce(updatedAccesses); // final state after transaction

      const result = await service.setAccess(USER_ID, [DOCTOR_ID], ADMIN_ID);

      expect(userDoctorAccessRepository.deactivate).toHaveBeenCalledWith(
        USER_ID,
        'old-doctor',
      );
      expect(userDoctorAccessRepository.upsert).toHaveBeenCalledWith({
        userId: USER_ID,
        doctorUserId: DOCTOR_ID,
        status: UserDoctorAccessStatus.ACTIVE,
        createdById: ADMIN_ID,
      });
      expect(result).toEqual({ records: updatedAccesses });
    });

    it('throws BadRequestException when a doctorUserId has no doctor_profile', async () => {
      const admin = makeAdmin();
      const user = makeUser();
      const nonDoctor = makeUser({ id: DOCTOR_ID });

      (userRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(admin)
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce(nonDoctor);

      (doctorProfileRepository.existsByUserId as jest.Mock).mockResolvedValueOnce(
        false,
      );

      await expect(
        service.setAccess(USER_ID, [DOCTOR_ID], ADMIN_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not deactivate doctors still in the new list', async () => {
      const admin = makeAdmin();
      const user = makeUser();
      const doctorUser = makeUser({ id: DOCTOR_ID });
      const existingAccess = { doctor_user_id: DOCTOR_ID, id: 'access-1' };

      (userRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(admin)
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce(doctorUser);

      (doctorProfileRepository.existsByUserId as jest.Mock).mockResolvedValueOnce(
        true,
      );

      (userDoctorAccessRepository.findAllByUserId as jest.Mock)
        .mockResolvedValueOnce([existingAccess])
        .mockResolvedValueOnce([existingAccess]);

      await service.setAccess(USER_ID, [DOCTOR_ID], ADMIN_ID);

      expect(userDoctorAccessRepository.deactivate).not.toHaveBeenCalled();
    });
  });

  // ── addAccess ──────────────────────────────────────────────────────────────

  describe('addAccess', () => {
    it('upserts a new individual access link', async () => {
      const admin = makeAdmin();
      const user = makeUser();
      const doctorUser = makeUser({ id: DOCTOR_ID });
      const created = { id: 'new-access' };

      (userRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(admin)
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce(doctorUser);

      (doctorProfileRepository.existsByUserId as jest.Mock).mockResolvedValueOnce(
        true,
      );
      (userDoctorAccessRepository.upsert as jest.Mock).mockResolvedValueOnce(
        created,
      );

      const result = await service.addAccess(USER_ID, DOCTOR_ID, ADMIN_ID);

      expect(userDoctorAccessRepository.upsert).toHaveBeenCalledWith({
        userId: USER_ID,
        doctorUserId: DOCTOR_ID,
        status: UserDoctorAccessStatus.ACTIVE,
        createdById: ADMIN_ID,
      });
      expect(result).toBe(created);
    });
  });

  // ── deactivateAccess ───────────────────────────────────────────────────────

  describe('deactivateAccess', () => {
    it('calls deactivate and returns success message', async () => {
      const admin = makeAdmin();
      const user = makeUser();

      (userRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(admin)
        .mockResolvedValueOnce(user);

      (userDoctorAccessRepository.deactivate as jest.Mock).mockResolvedValueOnce(
        undefined,
      );

      const result = await service.deactivateAccess(
        USER_ID,
        DOCTOR_ID,
        ADMIN_ID,
      );

      expect(userDoctorAccessRepository.deactivate).toHaveBeenCalledWith(
        USER_ID,
        DOCTOR_ID,
      );
      expect(result).toEqual({ message: 'Vínculo desativado com sucesso' });
    });

    it('throws ForbiddenException when user belongs to a different account', async () => {
      const admin = makeAdmin();
      const foreignUser = makeUser({ account_id: 'other-account' });

      (userRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(admin)
        .mockResolvedValueOnce(foreignUser);

      await expect(
        service.deactivateAccess(USER_ID, DOCTOR_ID, ADMIN_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
