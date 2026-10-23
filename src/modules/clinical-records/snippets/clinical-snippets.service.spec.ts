import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClinicalSnippetsService } from './clinical-snippets.service';

describe('ClinicalSnippetsService', () => {
  const snippet = {
    id: 'sn-1',
    ownerId: 'owner-1',
    doctorId: 'doctor-1',
    shortcut: 'normal',
    title: 'Exame físico normal',
    content: '<p>Bom estado geral.</p>',
    usageCount: 3,
  };

  const repository = {
    findByDoctor: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    shortcutInUse: jest.fn(),
    incrementUsage: jest.fn(),
  };

  const accessControl = {
    getOwnerId: jest.fn(),
    resolveDefaultDoctorId: jest.fn(),
    canAccessDoctor: jest.fn(),
    assertCanAccessDoctorResource: jest.fn(),
    assertIsDoctor: jest.fn(),
  };

  const service = new ClinicalSnippetsService(
    repository as never,
    accessControl as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    accessControl.assertIsDoctor.mockResolvedValue(undefined);
    accessControl.getOwnerId.mockResolvedValue('owner-1');
    accessControl.resolveDefaultDoctorId.mockResolvedValue('doctor-1');
    accessControl.canAccessDoctor.mockResolvedValue(true);
    accessControl.assertCanAccessDoctorResource.mockResolvedValue(undefined);
    repository.findByDoctor.mockResolvedValue([snippet]);
    repository.findOne.mockResolvedValue(snippet);
    repository.shortcutInUse.mockResolvedValue(false);
    repository.create.mockImplementation((data: object) =>
      Promise.resolve({ id: 'sn-novo', usageCount: 0, ...data }),
    );
    repository.update.mockImplementation((id: string, data: object) =>
      Promise.resolve({ ...snippet, ...data }),
    );
  });

  describe('findMany', () => {
    it('lista os do médico padrão de quem pede quando não vem doctorId', async () => {
      await expect(service.findMany('user-1')).resolves.toEqual([snippet]);
      expect(repository.findByDoctor).toHaveBeenCalledWith(
        'owner-1',
        'doctor-1',
      );
    });

    it('recusa médico sem vínculo com quem pede', async () => {
      accessControl.canAccessDoctor.mockResolvedValue(false);
      await expect(service.findMany('user-1', 'doctor-9')).rejects.toThrow(
        ForbiddenException,
      );
      expect(repository.findByDoctor).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    const dto = {
      shortcut: 'normal-joelho',
      title: '  Joelho normal  ',
      content: '<p>Sem derrame.</p>',
    };

    it('cria no médico padrão, dentro da conta', async () => {
      const criado = await service.create(dto, 'user-1');

      expect(repository.create).toHaveBeenCalledWith({
        ownerId: 'owner-1',
        doctorId: 'doctor-1',
        shortcut: 'normal-joelho',
        title: 'Joelho normal',
        content: '<p>Sem derrame.</p>',
      });
      expect(criado.id).toBe('sn-novo');
    });

    it('não deixa repetir atalho do mesmo médico', async () => {
      repository.shortcutInUse.mockResolvedValue(true);
      await expect(service.create(dto, 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('é ato do médico', async () => {
      accessControl.assertIsDoctor.mockRejectedValue(
        new ForbiddenException('Apenas médicos podem realizar esta operação.'),
      );
      await expect(service.create(dto, 'sec-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('troca o atalho conferindo conflito sem contar o próprio registro', async () => {
      await service.update('sn-1', { shortcut: 'exame-normal' }, 'user-1');

      expect(repository.shortcutInUse).toHaveBeenCalledWith(
        'doctor-1',
        'exame-normal',
        'sn-1',
      );
      expect(repository.update).toHaveBeenCalledWith('sn-1', {
        shortcut: 'exame-normal',
      });
    });

    it('manter o mesmo atalho não consulta conflito', async () => {
      await service.update(
        'sn-1',
        { shortcut: 'normal', title: 'Novo título' },
        'user-1',
      );
      expect(repository.shortcutInUse).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith('sn-1', {
        shortcut: 'normal',
        title: 'Novo título',
      });
    });

    it('409 quando o novo atalho já existe', async () => {
      repository.shortcutInUse.mockResolvedValue(true);
      await expect(
        service.update('sn-1', { shortcut: 'outro' }, 'user-1'),
      ).rejects.toThrow(ConflictException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('confere o acesso ao médico dono do texto', async () => {
      accessControl.assertCanAccessDoctorResource.mockRejectedValue(
        new ForbiddenException(),
      );
      await expect(
        service.update('sn-1', { title: 'x' }, 'user-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(accessControl.assertCanAccessDoctorResource).toHaveBeenCalledWith(
        'user-1',
        'owner-1',
        'doctor-1',
      );
    });

    it('404 quando não existe', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(
        service.update('sn-x', { title: 'x' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it('busca o texto só dentro da conta de quem pede (outra clínica vê 404)', async () => {
    repository.findOne.mockResolvedValue(null);
    accessControl.getOwnerId.mockResolvedValue('owner-2');

    await expect(service.registerUse('sn-1', 'user-x')).rejects.toThrow(
      NotFoundException,
    );
    expect(repository.findOne).toHaveBeenCalledWith({
      id: 'sn-1',
      ownerId: 'owner-2',
    });
    expect(repository.incrementUsage).not.toHaveBeenCalled();
  });

  it('delete confere acesso antes de excluir', async () => {
    await service.delete('sn-1', 'user-1');
    expect(accessControl.assertCanAccessDoctorResource).toHaveBeenCalled();
    expect(repository.delete).toHaveBeenCalledWith('sn-1');
  });

  describe('registerUse', () => {
    it('conta o uso conferindo o acesso ao médico dono do texto', async () => {
      await service.registerUse('sn-1', 'user-1');
      expect(accessControl.assertCanAccessDoctorResource).toHaveBeenCalledWith(
        'user-1',
        'owner-1',
        'doctor-1',
      );
      expect(repository.incrementUsage).toHaveBeenCalledWith('sn-1');
    });

    it('não conta uso sem vínculo com o médico, mesmo na mesma conta', async () => {
      accessControl.assertCanAccessDoctorResource.mockRejectedValue(
        new ForbiddenException(),
      );
      await expect(service.registerUse('sn-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(repository.incrementUsage).not.toHaveBeenCalled();
    });

    it('não conta uso de quem não é médico', async () => {
      accessControl.assertIsDoctor.mockRejectedValue(new ForbiddenException());
      await expect(service.registerUse('sn-1', 'sec-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(repository.incrementUsage).not.toHaveBeenCalled();
    });
  });
});
