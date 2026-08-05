import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClinicalDocumentsService } from './clinical-documents.service';

const PATIENT = { id: 'pat-1', ownerId: 'owner-1' };
const RECORD = {
  id: 'rec-1',
  ownerId: 'owner-1',
  doctorId: 'doctor-1',
  patientId: 'pat-1',
};

describe('ClinicalDocumentsService', () => {
  let service: ClinicalDocumentsService;
  let storageService: {
    create: jest.Mock;
    getSignedUrl: jest.Mock;
    delete: jest.Mock;
  };
  let documentRepository: {
    create: jest.Mock;
    findOneSimple: jest.Mock;
    findByPatientId: jest.Mock;
  };
  let patientRepository: { findOne: jest.Mock };
  let clinicalRecordRepository: { findOne: jest.Mock };
  let accessControlService: {
    assertSameOwner: jest.Mock;
    assertCanAccessDoctorResource: jest.Mock;
  };

  beforeEach(() => {
    storageService = {
      create: jest.fn().mockResolvedValue('documents/owner-1/exame.pdf'),
      getSignedUrl: jest.fn().mockResolvedValue('https://signed/exame.pdf'),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    documentRepository = {
      create: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      findOneSimple: jest.fn(),
      findByPatientId: jest.fn().mockResolvedValue([]),
    };
    patientRepository = { findOne: jest.fn().mockResolvedValue(PATIENT) };
    clinicalRecordRepository = {
      findOne: jest.fn().mockResolvedValue(RECORD),
    };
    accessControlService = {
      assertSameOwner: jest.fn().mockResolvedValue(undefined),
      assertCanAccessDoctorResource: jest.fn().mockResolvedValue(undefined),
    };

    service = new ClinicalDocumentsService(
      null as any,
      storageService as any,
      documentRepository as any,
      patientRepository as any,
      clinicalRecordRepository as any,
      accessControlService as any,
    );
  });

  const file = { originalname: 'exame.pdf' } as Express.Multer.File;

  describe('create', () => {
    it('sobe o arquivo no owner do paciente e persiste o Document vinculado', async () => {
      await service.create(
        {
          patientId: 'pat-1',
          clinicalRecordId: 'rec-1',
          type: 'exam_report',
          key: 'k',
          name: 'Exame.pdf',
          folder: 'documents',
        },
        'user-1',
        file,
      );

      expect(storageService.create).toHaveBeenCalledWith(
        file,
        'documents',
        'owner-1',
      );
      expect(documentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'pat-1',
          clinicalRecordId: 'rec-1',
          createdById: 'user-1',
          type: 'exam_report',
          uri: 'documents/owner-1/exame.pdf',
        }),
      );
    });

    it('rejeita quando o paciente é de outro tenant (assertSameOwner lança)', async () => {
      accessControlService.assertSameOwner.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.create(
          { patientId: 'pat-1', key: 'k', name: 'n', folder: 'documents' },
          'user-x',
          file,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(storageService.create).not.toHaveBeenCalled();
    });

    it('recusa vincular o anexo a ficha de médico fora do acesso do usuário', async () => {
      accessControlService.assertCanAccessDoctorResource.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.create(
          {
            patientId: 'pat-1',
            clinicalRecordId: 'rec-1',
            key: 'k',
            name: 'n',
            folder: 'documents',
          },
          'colaborador',
          file,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(
        accessControlService.assertCanAccessDoctorResource,
      ).toHaveBeenCalledWith('colaborador', 'owner-1', 'doctor-1');
      expect(storageService.create).not.toHaveBeenCalled();
    });

    it('recusa vincular o anexo a ficha de outro paciente', async () => {
      clinicalRecordRepository.findOne.mockResolvedValue({
        ...RECORD,
        patientId: 'outro-paciente',
      });

      await expect(
        service.create(
          {
            patientId: 'pat-1',
            clinicalRecordId: 'rec-1',
            key: 'k',
            name: 'n',
            folder: 'documents',
          },
          'user-1',
          file,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(storageService.create).not.toHaveBeenCalled();
    });

    it('não consulta a ficha quando o anexo é só do paciente', async () => {
      await service.create(
        { patientId: 'pat-1', key: 'k', name: 'n', folder: 'documents' },
        'user-1',
        file,
      );

      expect(clinicalRecordRepository.findOne).not.toHaveBeenCalled();
      expect(storageService.create).toHaveBeenCalled();
    });

    it('rejeita sem arquivo', async () => {
      await expect(
        service.create(
          { patientId: 'pat-1', key: 'k', name: 'n', folder: 'documents' },
          'user-1',
          undefined as any,
        ),
      ).rejects.toThrow('File is required');
    });
  });

  describe('listByPatient', () => {
    it('retorna documentos com URLs assinadas', async () => {
      documentRepository.findByPatientId.mockResolvedValue([
        { id: 'doc-1', uri: 'documents/owner-1/exame.pdf' },
      ]);

      const result = await service.listByPatient('pat-1', 'user-1');

      expect(result[0].uri).toBe('https://signed/exame.pdf');
    });
  });

  describe('delete', () => {
    it('404 quando o documento não existe ou não é de paciente', async () => {
      documentRepository.findOneSimple.mockResolvedValue(null);
      await expect(
        service.delete({ id: 'x', key: 'k' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('valida posse pelo owner do paciente do documento', async () => {
      documentRepository.findOneSimple.mockResolvedValue({
        id: 'doc-1',
        patientId: 'pat-1',
        uri: 'documents/owner-1/exame.pdf',
      });
      accessControlService.assertSameOwner.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.delete({ id: 'doc-1', key: 'k' }, 'user-x'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
