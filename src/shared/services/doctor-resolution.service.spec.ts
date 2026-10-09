import { ForbiddenException } from '@nestjs/common';
import { DoctorResolutionService } from './doctor-resolution.service';
import { AccessControlService } from './access-control.service';
import { UserRepository } from 'src/database/repositories/user.repository';

describe('DoctorResolutionService', () => {
  const access = {
    getAccessibleDoctorIds: jest.fn(),
    assertIsPhysician: jest.fn(),
  };
  const users = {
    findOneWithProfile: jest.fn(),
    findManyWithProfileByIds: jest.fn(),
  };
  const service = new DoctorResolutionService(
    access as unknown as AccessControlService,
    users as unknown as UserRepository,
  );

  const usuario = (id: string, council: string | null) => ({
    id,
    doctorProfile: council ? { id: `p-${id}`, council } : null,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    access.assertIsPhysician.mockResolvedValue(undefined);
  });

  describe('com médico informado', () => {
    it('aceita médico acessível', async () => {
      access.getAccessibleDoctorIds.mockResolvedValue(['crm-1']);

      await expect(service.resolveDoctorId('u', 'crm-1')).resolves.toBe(
        'crm-1',
      );
      expect(access.assertIsPhysician).toHaveBeenCalledWith(
        'crm-1',
        expect.any(String),
      );
    });

    it('recusa profissional acessível que não é médico', async () => {
      access.getAccessibleDoctorIds.mockResolvedValue(['crn-1']);
      access.assertIsPhysician.mockRejectedValue(new ForbiddenException());

      await expect(service.resolveDoctorId('u', 'crn-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('recusa médico fora do acesso antes de olhar o conselho', async () => {
      access.getAccessibleDoctorIds.mockResolvedValue(['outro']);

      await expect(service.resolveDoctorId('u', 'crm-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(access.assertIsPhysician).not.toHaveBeenCalled();
    });
  });

  describe('sem médico informado', () => {
    it('usa o próprio usuário quando ele é médico', async () => {
      users.findOneWithProfile.mockResolvedValue(usuario('crm-1', 'CRM'));

      await expect(service.resolveDoctorId('crm-1')).resolves.toBe('crm-1');
      expect(access.getAccessibleDoctorIds).not.toHaveBeenCalled();
    });

    it('profissional não médico cai no primeiro médico acessível', async () => {
      users.findOneWithProfile.mockResolvedValue(usuario('crn-1', 'CRN'));
      access.getAccessibleDoctorIds.mockResolvedValue(['crn-1', 'crm-2']);
      users.findManyWithProfileByIds.mockResolvedValue([
        usuario('crn-1', 'CRN'),
        usuario('crm-2', 'CRM'),
      ]);

      await expect(service.resolveDoctorId('crn-1')).resolves.toBe('crm-2');
    });

    it('mantém a ordem dos acessíveis entre os médicos', async () => {
      users.findOneWithProfile.mockResolvedValue(usuario('sec', null));
      access.getAccessibleDoctorIds.mockResolvedValue(['crm-a', 'crm-b']);
      users.findManyWithProfileByIds.mockResolvedValue([
        usuario('crm-b', 'CRM'),
        usuario('crm-a', 'CRM'),
      ]);

      await expect(service.resolveDoctorId('sec')).resolves.toBe('crm-a');
    });

    it('recusa quando só há profissionais não médicos acessíveis', async () => {
      users.findOneWithProfile.mockResolvedValue(usuario('sec', null));
      access.getAccessibleDoctorIds.mockResolvedValue(['crn-1']);
      users.findManyWithProfileByIds.mockResolvedValue([
        usuario('crn-1', 'CRN'),
      ]);

      await expect(service.resolveDoctorId('sec')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
