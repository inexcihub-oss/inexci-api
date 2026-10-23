import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClinicalRecordTemplateRepository } from 'src/database/repositories/clinical-record-template.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { ClinicalRecordTemplatesService } from './clinical-record-templates.service';

describe('ClinicalRecordTemplatesService', () => {
  let service: ClinicalRecordTemplatesService;

  const template = {
    id: 'tpl-1',
    ownerId: 'owner-1',
    doctorId: 'user-1',
    name: 'Primeira consulta — ortopedia',
    specialty: 'Ortopedia',
    anamnesis: '<p>Queixa principal:</p>',
    physicalExam: null,
    diagnosis: null,
    conduct: null,
    cidCodes: null,
    usageCount: 4,
  };

  const repository = {
    findByOwner: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    incrementUsage: jest.fn(),
  };

  const accessControlService = {
    getOwnerId: jest.fn(),
    isDoctor: jest.fn(),
    assertIsDoctor: jest.fn(),
  };

  const naoEhMedico = () => {
    accessControlService.isDoctor.mockResolvedValue(false);
    accessControlService.assertIsDoctor.mockRejectedValue(
      new ForbiddenException('Apenas médicos podem realizar esta operação.'),
    );
  };

  const deOutroMedico = () => repository.findOne.mockResolvedValue(null);

  beforeEach(async () => {
    jest.clearAllMocks();
    accessControlService.isDoctor.mockResolvedValue(true);
    accessControlService.assertIsDoctor.mockResolvedValue(undefined);
    accessControlService.getOwnerId.mockResolvedValue('owner-1');
    repository.findByOwner.mockResolvedValue([template]);
    repository.findOne.mockResolvedValue(template);
    repository.create.mockImplementation((data: any) =>
      Promise.resolve({ id: 'tpl-novo', usageCount: 0, ...data }),
    );
    repository.update.mockImplementation((id: string, data: any) =>
      Promise.resolve({ ...template, id, ...data }),
    );

    const module = await Test.createTestingModule({
      providers: [
        ClinicalRecordTemplatesService,
        {
          provide: ClinicalRecordTemplateRepository,
          useValue: repository,
        },
        { provide: AccessControlService, useValue: accessControlService },
      ],
    }).compile();

    service = module.get(ClinicalRecordTemplatesService);
  });

  describe('listagem', () => {
    it('lista só os modelos do próprio médico, na conta dele', async () => {
      const result = await service.findMany('user-1');

      expect(repository.findByOwner).toHaveBeenCalledWith('owner-1', 'user-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('criação', () => {
    it('grava o modelo na clínica e no próprio médico', async () => {
      const created = await service.create(
        { name: 'Retorno', anamnesis: '<p>Evolução:</p>' },
        'user-1',
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          doctorId: 'user-1',
          name: 'Retorno',
          anamnesis: '<p>Evolução:</p>',
        }),
      );
      expect(created.id).toBe('tpl-novo');
    });

    it('aceita doctorId igual ao próprio usuário', async () => {
      await service.create({ name: 'Retorno', doctorId: 'user-1' }, 'user-1');

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: 'user-1' }),
      );
    });

    it('recusa criar modelo para outro médico, mesmo com vínculo', async () => {
      await expect(
        service.create({ name: 'Retorno', doctorId: 'doctor-2' }, 'user-1'),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('edição e exclusão', () => {
    it('busca o modelo só entre os do próprio médico', async () => {
      await service.update('tpl-1', { name: 'Novo nome' }, 'user-1');

      expect(repository.findOne).toHaveBeenCalledWith({
        id: 'tpl-1',
        ownerId: 'owner-1',
        doctorId: 'user-1',
      });
    });

    it('atualiza apenas os campos enviados', async () => {
      await service.update('tpl-1', { name: 'Novo nome' }, 'user-1');

      expect(repository.update).toHaveBeenCalledWith('tpl-1', {
        name: 'Novo nome',
      });
    });

    it('permite limpar um campo do modelo', async () => {
      await service.update('tpl-1', { anamnesis: '' }, 'user-1');

      expect(repository.update).toHaveBeenCalledWith('tpl-1', {
        anamnesis: '',
      });
    });

    it('recusa editar modelo de outro médico', async () => {
      deOutroMedico();

      await expect(
        service.update('tpl-1', { name: 'x' }, 'doctor-2'),
      ).rejects.toThrow(NotFoundException);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it('recusa excluir modelo de outro médico', async () => {
      deOutroMedico();

      await expect(service.delete('tpl-1', 'doctor-2')).rejects.toThrow(
        NotFoundException,
      );

      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('exclui o próprio modelo', async () => {
      await service.delete('tpl-1', 'user-1');

      expect(repository.delete).toHaveBeenCalledWith('tpl-1');
    });
  });

  describe('aplicação', () => {
    it('conta o uso ao aplicar o próprio modelo na ficha', async () => {
      const applied = await service.apply('tpl-1', 'user-1');

      expect(repository.incrementUsage).toHaveBeenCalledWith('tpl-1');
      expect(applied.anamnesis).toBe('<p>Queixa principal:</p>');
    });

    it('não aplica modelo de outro médico', async () => {
      deOutroMedico();

      await expect(service.apply('tpl-1', 'doctor-2')).rejects.toThrow(
        NotFoundException,
      );

      expect(repository.incrementUsage).not.toHaveBeenCalled();
    });
  });

  describe('escrever no modelo é ato do médico (D-17)', () => {
    it('recusa criação por quem não tem doctor_profile', async () => {
      naoEhMedico();

      await expect(
        service.create({ name: 'Retorno' }, 'secretaria'),
      ).rejects.toThrow(ForbiddenException);

      expect(accessControlService.assertIsDoctor).toHaveBeenCalledWith(
        'secretaria',
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('recusa edição por quem não tem doctor_profile, mesmo com acesso ao médico', async () => {
      naoEhMedico();

      await expect(
        service.update('tpl-1', { name: 'Renomeado' }, 'secretaria'),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it('recusa exclusão por quem não tem doctor_profile', async () => {
      naoEhMedico();

      await expect(service.delete('tpl-1', 'secretaria')).rejects.toThrow(
        ForbiddenException,
      );

      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('recusa aplicar o modelo (conta uso) por quem não escreve na ficha', async () => {
      naoEhMedico();

      await expect(service.apply('tpl-1', 'secretaria')).rejects.toThrow(
        ForbiddenException,
      );

      expect(repository.incrementUsage).not.toHaveBeenCalled();
    });

    it('quem não é médico não tem modelos para listar', async () => {
      naoEhMedico();

      const result = await service.findMany('secretaria');

      expect(result).toEqual([]);
      expect(repository.findByOwner).not.toHaveBeenCalled();
    });

    it('exige ser médico ANTES de aceitar o médico informado no corpo', async () => {
      naoEhMedico();

      await expect(
        service.create(
          { name: 'Retorno', doctorId: 'secretaria' },
          'secretaria',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.create).not.toHaveBeenCalled();
    });
  });
});
