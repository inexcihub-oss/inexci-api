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
    doctorId: 'doc-1',
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
    isDoctor: jest.fn(),
    assertIsDoctor: jest.fn(),
  };

  const service = new ClinicalSnippetsService(
    repository as never,
    accessControl as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    accessControl.isDoctor.mockResolvedValue(true);
    accessControl.assertIsDoctor.mockResolvedValue(undefined);
    accessControl.getOwnerId.mockResolvedValue('owner-1');
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
    it('lista só os textos do próprio médico', async () => {
      await expect(service.findMany('doc-1')).resolves.toEqual([snippet]);
      expect(repository.findByDoctor).toHaveBeenCalledWith('owner-1', 'doc-1');
    });

    it('quem não é médico não tem textos rápidos', async () => {
      accessControl.isDoctor.mockResolvedValue(false);
      await expect(service.findMany('sec-1')).resolves.toEqual([]);
      expect(repository.findByDoctor).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    const dto = {
      shortcut: 'normal-joelho',
      title: '  Joelho normal  ',
      content: '<p>Sem derrame.</p>',
    };

    it('cria no próprio médico, dentro da conta', async () => {
      const criado = await service.create(dto, 'doc-1');

      expect(repository.shortcutInUse).toHaveBeenCalledWith(
        'doc-1',
        'normal-joelho',
      );
      expect(repository.create).toHaveBeenCalledWith({
        ownerId: 'owner-1',
        doctorId: 'doc-1',
        shortcut: 'normal-joelho',
        title: 'Joelho normal',
        content: '<p>Sem derrame.</p>',
      });
      expect(criado.id).toBe('sn-novo');
    });

    it('aceita doctorId igual ao próprio usuário', async () => {
      await service.create({ ...dto, doctorId: 'doc-1' }, 'doc-1');
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: 'doc-1' }),
      );
    });

    it('não cria texto rápido para outro médico, mesmo com vínculo', async () => {
      await expect(
        service.create({ ...dto, doctorId: 'doc-2' }, 'doc-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('não deixa repetir atalho do mesmo médico', async () => {
      repository.shortcutInUse.mockResolvedValue(true);
      await expect(service.create(dto, 'doc-1')).rejects.toThrow(
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
      await service.update('sn-1', { shortcut: 'exame-normal' }, 'doc-1');

      expect(repository.shortcutInUse).toHaveBeenCalledWith(
        'doc-1',
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
        'doc-1',
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
        service.update('sn-1', { shortcut: 'outro' }, 'doc-1'),
      ).rejects.toThrow(ConflictException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('404 quando não existe', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(
        service.update('sn-x', { title: 'x' }, 'doc-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it('busca o texto só entre os do próprio médico, na conta dele', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.update('sn-1', { title: 'x' }, 'doc-2'),
    ).rejects.toThrow(NotFoundException);
    expect(repository.findOne).toHaveBeenCalledWith({
      id: 'sn-1',
      ownerId: 'owner-1',
      doctorId: 'doc-2',
    });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('não exclui texto rápido de outro médico', async () => {
    repository.findOne.mockResolvedValue(null);
    await expect(service.delete('sn-1', 'doc-2')).rejects.toThrow(
      NotFoundException,
    );
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('exclui o próprio texto rápido', async () => {
    await service.delete('sn-1', 'doc-1');
    expect(repository.delete).toHaveBeenCalledWith('sn-1');
  });

  describe('registerUse', () => {
    it('conta o uso do próprio texto', async () => {
      await service.registerUse('sn-1', 'doc-1');
      expect(repository.incrementUsage).toHaveBeenCalledWith('sn-1');
    });

    it('não conta uso de texto de outro médico', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(service.registerUse('sn-1', 'doc-2')).rejects.toThrow(
        NotFoundException,
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
