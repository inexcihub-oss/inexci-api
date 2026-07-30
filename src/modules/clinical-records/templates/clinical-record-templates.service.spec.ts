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
    doctorId: 'doctor-1',
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
    resolveDefaultDoctorId: jest.fn(),
    canAccessDoctor: jest.fn(),
    assertSameOwner: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    accessControlService.getOwnerId.mockResolvedValue('owner-1');
    accessControlService.resolveDefaultDoctorId.mockResolvedValue('doctor-1');
    accessControlService.canAccessDoctor.mockResolvedValue(true);
    accessControlService.assertSameOwner.mockResolvedValue(undefined);
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
    it('lista os modelos da clínica do usuário', async () => {
      const result = await service.findMany('user-1');

      expect(repository.findByOwner).toHaveBeenCalledWith('owner-1', undefined);
      expect(result).toHaveLength(1);
    });

    it('filtra pelos modelos de um médico específico', async () => {
      await service.findMany('user-1', 'doctor-2');

      expect(repository.findByOwner).toHaveBeenCalledWith(
        'owner-1',
        'doctor-2',
      );
    });
  });

  describe('criação', () => {
    it('grava o modelo na clínica do usuário e no médico resolvido', async () => {
      const created = await service.create(
        { name: 'Retorno', anamnesis: '<p>Evolução:</p>' } as any,
        'user-1',
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-1',
          doctorId: 'doctor-1',
          name: 'Retorno',
          anamnesis: '<p>Evolução:</p>',
        }),
      );
      expect(created.id).toBe('tpl-novo');
    });

    it('usa o médico informado quando o usuário tem acesso a ele', async () => {
      await service.create(
        { name: 'Retorno', doctorId: 'doctor-2' } as any,
        'user-1',
      );

      expect(accessControlService.canAccessDoctor).toHaveBeenCalledWith(
        'user-1',
        'doctor-2',
      );
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: 'doctor-2' }),
      );
    });

    it('recusa criar modelo para médico fora do acesso do usuário', async () => {
      accessControlService.canAccessDoctor.mockResolvedValue(false);

      await expect(
        service.create(
          { name: 'Retorno', doctorId: 'alheio' } as any,
          'user-1',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('edição e exclusão', () => {
    it('atualiza apenas os campos enviados', async () => {
      await service.update('tpl-1', { name: 'Novo nome' } as any, 'user-1');

      expect(repository.update).toHaveBeenCalledWith('tpl-1', {
        name: 'Novo nome',
      });
    });

    it('permite limpar um campo do modelo', async () => {
      await service.update('tpl-1', { anamnesis: '' } as any, 'user-1');

      expect(repository.update).toHaveBeenCalledWith('tpl-1', {
        anamnesis: '',
      });
    });

    it('recusa editar modelo de outra clínica', async () => {
      accessControlService.assertSameOwner.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.update('tpl-1', { name: 'x' } as any, 'intruso'),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it('falha quando o modelo não existe', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.update('sumido', { name: 'x' } as any, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('exclui o modelo depois de validar o tenant', async () => {
      await service.delete('tpl-1', 'user-1');

      expect(accessControlService.assertSameOwner).toHaveBeenCalledWith(
        'user-1',
        'owner-1',
      );
      expect(repository.delete).toHaveBeenCalledWith('tpl-1');
    });
  });

  describe('aplicação', () => {
    it('conta o uso ao aplicar o modelo na ficha', async () => {
      const applied = await service.apply('tpl-1', 'user-1');

      expect(repository.incrementUsage).toHaveBeenCalledWith('tpl-1');
      expect(applied.anamnesis).toBe('<p>Queixa principal:</p>');
    });

    it('não aplica modelo de outra clínica', async () => {
      accessControlService.assertSameOwner.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(service.apply('tpl-1', 'intruso')).rejects.toThrow(
        ForbiddenException,
      );

      expect(repository.incrementUsage).not.toHaveBeenCalled();
    });
  });
});
