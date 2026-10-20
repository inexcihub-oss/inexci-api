import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClinicalDocumentsService } from './clinical-documents.service';

jest.mock(
  'file-type',
  () => ({
    fileTypeFromBuffer: (buf: Buffer) =>
      Promise.resolve(
        buf.subarray(0, 4).toString() === '%PDF'
          ? { ext: 'pdf', mime: 'application/pdf' }
          : undefined,
      ),
  }),
  { virtual: true },
);
import { STORAGE_FOLDERS } from 'src/config/storage.config';

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
    findByPatientIdForDoctors: jest.Mock;
  };
  let patientRepository: { findOne: jest.Mock };
  let clinicalRecordRepository: { findOne: jest.Mock };
  let accessControlService: {
    assertSameOwner: jest.Mock;
    assertCanAccessDoctorResource: jest.Mock;
    assertIsDoctor: jest.Mock;
    getAccessibleDoctorIds: jest.Mock;
  };
  let documentTypeormRepo: { delete: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  beforeEach(() => {
    storageService = {
      create: jest.fn().mockResolvedValue('documents/owner-1/exame.pdf'),
      getSignedUrl: jest.fn().mockResolvedValue('https://signed/exame.pdf'),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    documentRepository = {
      create: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      findOneSimple: jest.fn(),
      findByPatientIdForDoctors: jest.fn().mockResolvedValue([]),
    };
    patientRepository = { findOne: jest.fn().mockResolvedValue(PATIENT) };
    clinicalRecordRepository = {
      findOne: jest.fn().mockResolvedValue(RECORD),
    };
    accessControlService = {
      assertSameOwner: jest.fn().mockResolvedValue(undefined),
      assertCanAccessDoctorResource: jest.fn().mockResolvedValue(undefined),
      assertIsDoctor: jest.fn().mockResolvedValue(undefined),
      getAccessibleDoctorIds: jest.fn().mockResolvedValue(['doctor-1']),
    };

    documentTypeormRepo = {
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    dataSource = {
      transaction: jest.fn((fn: any) =>
        fn({ getRepository: () => documentTypeormRepo }),
      ),
    };

    service = new ClinicalDocumentsService(
      dataSource as any,
      storageService as any,
      documentRepository as any,
      patientRepository as any,
      clinicalRecordRepository as any,
      accessControlService as any,
    );
  });

  const file = {
    originalname: 'exame.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7'),
  } as Express.Multer.File;

  describe('create — limite de tamanho por pasta', () => {
    const arquivo = (bytes: number): Express.Multer.File =>
      ({
        originalname: 'exame.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(bytes - 5)]),
        size: bytes,
      }) as Express.Multer.File;

    it('recusa arquivo acima do limite da pasta', async () => {
      await expect(
        service.create(
          {
            patientId: 'pat-1',
            key: 'k',
            name: 'n',
            folder: STORAGE_FOLDERS.SIGNATURES,
          },
          'user-1',
          arquivo(600 * 1024),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(storageService.create).not.toHaveBeenCalled();
    });

    it('aceita arquivo dentro do limite da pasta (40 MB em documents)', async () => {
      await expect(
        service.create(
          {
            patientId: 'pat-1',
            key: 'k',
            name: 'n',
            folder: STORAGE_FOLDERS.DOCUMENTS,
          },
          'user-1',
          arquivo(40 * 1024 * 1024),
        ),
      ).resolves.toMatchObject({ id: 'doc-1' });
      expect(storageService.create).toHaveBeenCalled();
    });
  });

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
        expect.objectContaining({
          originalname: 'exame.pdf',
          mimetype: 'application/pdf',
        }),
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
      documentRepository.findByPatientIdForDoctors.mockResolvedValue([
        { id: 'doc-1', uri: 'documents/owner-1/exame.pdf' },
      ]);

      const result = await service.listByPatient('pat-1', 'user-1');

      expect(result[0].uri).toBe('https://signed/exame.pdf');
    });

    it('filtra pelos médicos que o usuário acessa', async () => {
      accessControlService.getAccessibleDoctorIds.mockResolvedValue([
        'doctor-1',
        'doctor-2',
      ]);

      await service.listByPatient('pat-1', 'colaborador');

      expect(accessControlService.getAccessibleDoctorIds).toHaveBeenCalledWith(
        'colaborador',
      );
      expect(documentRepository.findByPatientIdForDoctors).toHaveBeenCalledWith(
        'pat-1',
        ['doctor-1', 'doctor-2'],
      );
    });
  });

  describe('create — tipo do arquivo', () => {
    it('recusa HTML sem gravar nada', async () => {
      await expect(
        service.create(
          { patientId: 'pat-1', key: 'k', name: 'n', folder: 'documents' },
          'user-1',
          {
            originalname: 'x.html',
            mimetype: 'text/html',
            buffer: Buffer.from('<script>'),
          } as Express.Multer.File,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(storageService.create).not.toHaveBeenCalled();
      expect(documentRepository.create).not.toHaveBeenCalled();
    });

    it('recusa SVG disfarçado de PDF', async () => {
      await expect(
        service.create(
          { patientId: 'pat-1', key: 'k', name: 'n', folder: 'documents' },
          'user-1',
          {
            originalname: 'x.pdf',
            mimetype: 'application/pdf',
            buffer: Buffer.from('<svg onload=alert(1)/>'),
          } as Express.Multer.File,
        ),
      ).rejects.toThrow('Tipo de arquivo inválido');
      expect(storageService.create).not.toHaveBeenCalled();
    });
  });

  describe('delete — recorte por médico e documentos emitidos', () => {
    const anexoDaFicha = {
      id: 'doc-1',
      patientId: 'pat-1',
      clinicalRecordId: 'rec-1',
      createdById: 'secretaria',
      key: 'exam',
      uri: 'documents/owner-1/exame.pdf',
    };
    const receita = {
      ...anexoDaFicha,
      key: 'prescription',
      type: 'prescription',
      createdById: 'doctor-1',
      uri: 'documents/owner-1/receita.pdf',
    };

    it('recusa excluir anexo de ficha de médico que o usuário não acessa', async () => {
      documentRepository.findOneSimple.mockResolvedValue(anexoDaFicha);
      accessControlService.assertCanAccessDoctorResource.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.delete({ id: 'doc-1', key: 'exam' }, 'colaborador'),
      ).rejects.toThrow(ForbiddenException);

      expect(
        accessControlService.assertCanAccessDoctorResource,
      ).toHaveBeenCalledWith('colaborador', 'owner-1', 'doctor-1');
      expect(documentTypeormRepo.delete).not.toHaveBeenCalled();
      expect(storageService.delete).not.toHaveBeenCalled();
    });

    it('anexo comum da ficha pode ser excluído por quem acessa o médico', async () => {
      documentRepository.findOneSimple.mockResolvedValue(anexoDaFicha);

      await service.delete({ id: 'doc-1', key: 'exam' }, 'secretaria');

      expect(accessControlService.assertIsDoctor).not.toHaveBeenCalled();
      expect(documentTypeormRepo.delete).toHaveBeenCalled();
    });

    it('documento emitido não pode ser excluído por quem não é médico', async () => {
      documentRepository.findOneSimple.mockResolvedValue(receita);
      accessControlService.assertIsDoctor.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.delete({ id: 'doc-1', key: 'prescription' }, 'secretaria'),
      ).rejects.toThrow(ForbiddenException);
      expect(documentTypeormRepo.delete).not.toHaveBeenCalled();
    });

    it('documento emitido não pode ser excluído por outro médico', async () => {
      documentRepository.findOneSimple.mockResolvedValue(receita);

      await expect(
        service.delete({ id: 'doc-1', key: 'prescription' }, 'doctor-2'),
      ).rejects.toThrow(
        'Só o médico que emitiu este documento pode excluí-lo.',
      );
      expect(documentTypeormRepo.delete).not.toHaveBeenCalled();
      expect(storageService.delete).not.toHaveBeenCalled();
    });

    it('o médico que emitiu pode excluir', async () => {
      documentRepository.findOneSimple.mockResolvedValue(receita);

      await service.delete({ id: 'doc-1', key: 'prescription' }, 'doctor-1');

      expect(accessControlService.assertIsDoctor).toHaveBeenCalledWith(
        'doctor-1',
      );
      expect(storageService.delete).toHaveBeenCalledWith(
        'documents/owner-1/receita.pdf',
      );
    });

    it('anexo só do paciente (sem ficha) não consulta a ficha', async () => {
      documentRepository.findOneSimple.mockResolvedValue({
        ...anexoDaFicha,
        clinicalRecordId: null,
      });

      await service.delete({ id: 'doc-1', key: 'exam' }, 'secretaria');

      expect(clinicalRecordRepository.findOne).not.toHaveBeenCalled();
      expect(documentTypeormRepo.delete).toHaveBeenCalled();
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
        key: 'k',
        uri: 'documents/owner-1/exame.pdf',
      });
      accessControlService.assertSameOwner.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        service.delete({ id: 'doc-1', key: 'k' }, 'user-x'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('404 e não toca no R2 quando o `key` informado não casa com o do documento', async () => {
      documentRepository.findOneSimple.mockResolvedValue({
        id: 'doc-1',
        patientId: 'pat-1',
        key: 'key-correta.pdf',
        uri: 'documents/owner-1/exame.pdf',
      });

      await expect(
        service.delete(
          { id: 'doc-1', key: 'key-totalmente-errado.pdf' },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(storageService.delete).not.toHaveBeenCalled();
      expect(documentTypeormRepo.delete).not.toHaveBeenCalled();
      expect(accessControlService.assertSameOwner).not.toHaveBeenCalled();
    });

    it('404 e não toca no R2 quando o DELETE no banco não afeta linha nenhuma', async () => {
      documentRepository.findOneSimple.mockResolvedValue({
        id: 'doc-1',
        patientId: 'pat-1',
        key: 'k',
        uri: 'documents/owner-1/exame.pdf',
      });
      documentTypeormRepo.delete.mockResolvedValue({ affected: 0 });

      await expect(
        service.delete({ id: 'doc-1', key: 'k' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);

      expect(storageService.delete).not.toHaveBeenCalled();
    });

    it('apaga no R2 quando o `key` casa e a linha foi removida', async () => {
      documentRepository.findOneSimple.mockResolvedValue({
        id: 'doc-1',
        patientId: 'pat-1',
        key: 'k',
        uri: 'documents/owner-1/exame.pdf',
      });
      documentTypeormRepo.delete.mockResolvedValue({ affected: 1 });

      await service.delete({ id: 'doc-1', key: 'k' }, 'user-1');

      expect(documentTypeormRepo.delete).toHaveBeenCalledWith({
        id: 'doc-1',
        key: 'k',
      });
      expect(storageService.delete).toHaveBeenCalledWith(
        'documents/owner-1/exame.pdf',
      );
    });
  });
});
