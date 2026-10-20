import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SurgeryRequestFromDocumentService } from './surgery-request-from-document.service';

const buildFile = (
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File =>
  ({
    buffer: Buffer.from('pdf-bytes'),
    mimetype: 'application/pdf',
    originalname: 'laudo.pdf',
    size: 1024,
    fieldname: 'document',
    encoding: '7bit',
    ...overrides,
  }) as Express.Multer.File;

const buildClassification = () => ({
  kind: 'medical_report' as const,
  confidence: 0.88,
  suggestedDocumentType: 'medical_report',
  extracted: {
    patient: { name: 'Joao Silva', cpf: '{{cpf_1}}' },
    hospital: 'Hospital X',
    healthPlan: { name: 'Bradesco' },
    suggestedProcedureName: 'Artrodese',
  },
  durationMs: 50,
  model: 'gpt-4o-mini',
});

const buildExtractTiming = () => ({
  totalMs: 120,
  ocrMs: 45,
  classifierMs: 60,
  visionRasterizeMs: 0,
  visionMs: 0,
  detokenizeMs: 2,
});

describe('SurgeryRequestFromDocumentService', () => {
  let extractor: any;
  let storage: any;
  let accessControl: any;
  let patientsService: any;
  let mutationService: any;
  let surgeryRequestRepository: any;
  let patientRepo: any;
  let manager: any;
  let assemblyService: any;
  let entityResolver: any;
  let documentsService: any;
  let configService: any;
  let dataSource: any;
  let service: SurgeryRequestFromDocumentService;

  beforeEach(() => {
    extractor = {
      extractFromBuffer: jest.fn().mockResolvedValue({
        status: 'ok',
        classification: buildClassification(),
        usedVisionFallback: false,
        usageSnapshots: [],
        ocrTokenizedText: 'texto...',
        ocrSource: 'pdf-native',
        timing: buildExtractTiming(),
      }),
    };
    storage = {
      uploadBuffer: jest
        .fn()
        .mockResolvedValue('sc-from-document-tmp/owner-1/uuid.pdf'),
      move: jest.fn().mockResolvedValue('documents/owner-1/uuid.pdf'),
    };
    accessControl = {
      getOwnerId: jest.fn().mockResolvedValue('owner-1'),
      buildSurgeryAccessWhere: jest.fn(async (where: any) => ({
        ...where,
        ownerId: 'owner-1',
      })),
    };
    patientsService = {
      create: jest.fn().mockResolvedValue({ id: 'patient-new' }),
      sendWelcome: jest.fn().mockResolvedValue(undefined),
    };
    mutationService = {
      createSurgeryRequest: jest
        .fn()
        .mockResolvedValue({ id: 'sc-1', protocol: 'SC-2024-0001' }),
      assertBelongsToOwner: jest.fn().mockResolvedValue(undefined),
      broadcastCreated: jest.fn().mockResolvedValue(undefined),
    };
    surgeryRequestRepository = {
      findOneSimple: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    };
    assemblyService = {
      assembleFromExtracted: jest.fn().mockResolvedValue({ warnings: [] }),
    };
    entityResolver = {
      resolveCandidates: jest.fn().mockResolvedValue({
        patient: [{ id: 'p-1', name: 'Joao Silva' }],
        hospital: [{ id: 'h-1', name: 'Hospital X' }],
        healthPlan: [{ id: 'hp-1', name: 'Bradesco' }],
        procedure: [{ id: 'pr-1', name: 'Artrodese' }],
        patientCpfMissing: false,
        patientMatchedByCpf: true,
      }),
      resolveOrCreateHospitalId: jest.fn().mockResolvedValue(undefined),
      resolveOrCreateHealthPlanId: jest.fn().mockResolvedValue(undefined),
      resolveOrCreateProcedureId: jest.fn().mockResolvedValue(undefined),
    };
    documentsService = {
      createFromPath: jest.fn().mockResolvedValue({ id: 'doc-1' }),
    };
    configService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'AI_DOC_SC_FROM_DOCUMENT_MAX_PAGES') return 15;
        if (key === 'AI_DOC_MAX_BYTES') return 10 * 1024 * 1024;
        return defaultValue;
      }),
    };
    patientRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    };
    manager = { getRepository: jest.fn(() => patientRepo) };
    dataSource = {
      manager,
      transaction: jest.fn(async (cb: any) => cb(manager)),
    };

    service = new SurgeryRequestFromDocumentService(
      extractor,
      storage,
      accessControl,
      patientsService,
      mutationService,
      assemblyService,
      entityResolver,
      documentsService,
      configService,
      dataSource,
      surgeryRequestRepository,
    );
  });

  it('extrai e retorna DTO completo com candidatos e tempStoragePath', async () => {
    const result = await service.extractFromDocument(buildFile(), 'user-1');

    expect(extractor.extractFromBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        buffer: expect.any(Buffer),
        mimeType: 'application/pdf',
        filename: 'laudo.pdf',
        intent: 'create_sc',
        maxOcrPages: 15,
      }),
    );
    expect(storage.uploadBuffer).toHaveBeenCalled();
    expect(entityResolver.resolveCandidates).toHaveBeenCalled();
    expect(result.kind).toBe('medical_report');
    expect(result.confidence).toBeCloseTo(0.88);
    expect(result.patientMatchedByCpf).toBe(true);
    expect(result.candidates.patient).toHaveLength(1);
    expect(result.tempStoragePath).toBe(
      'sc-from-document-tmp/owner-1/uuid.pdf',
    );
  });

  it('lança BadRequestException quando arquivo excede tamanho máximo', async () => {
    configService.get.mockReturnValueOnce(1024);

    await expect(
      service.extractFromDocument(buildFile({ size: 2048 }), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(extractor.extractFromBuffer).not.toHaveBeenCalled();
  });

  it('lança BadRequestException quando extrator retorna ocr_empty', async () => {
    extractor.extractFromBuffer.mockResolvedValueOnce({
      status: 'ocr_empty',
      classification: null,
      usedVisionFallback: false,
      usageSnapshots: [],
      ocrTokenizedText: '',
    });

    await expect(
      service.extractFromDocument(buildFile(), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.uploadBuffer).not.toHaveBeenCalled();
  });

  it('lança BadRequestException quando extrator retorna classifier_failed', async () => {
    extractor.extractFromBuffer.mockResolvedValueOnce({
      status: 'classifier_failed',
      classification: null,
      usedVisionFallback: false,
      usageSnapshots: [],
      ocrTokenizedText: 'texto...',
    });

    await expect(
      service.extractFromDocument(buildFile(), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cria SC com paciente existente e retorna id+protocol', async () => {
    const result = await service.createFromDocument(
      {
        doctorId: 'doctor-1',
        patientId: 'patient-1',
        procedureId: 'proc-1',
        tempStoragePath: 'sc-from-document-tmp/owner-1/doc.pdf',
        originalFileName: 'laudo.pdf',
      },
      'user-1',
    );

    expect(mutationService.createSurgeryRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'patient-1',
        procedureId: 'proc-1',
      }),
      'user-1',
      { manager },
    );
    expect(assemblyService.assembleFromExtracted).toHaveBeenCalledWith(
      expect.objectContaining({ scId: 'sc-1' }),
    );
    expect(storage.move).toHaveBeenCalledWith(
      'sc-from-document-tmp/owner-1/doc.pdf',
      'documents/owner-1',
    );
    expect(documentsService.createFromPath).toHaveBeenCalledWith(
      expect.objectContaining({
        surgeryRequestId: 'sc-1',
        name: 'laudo.pdf',
        type: 'sc_creation_source',
        key: 'sc_creation_source',
      }),
    );
    expect(result.id).toBe('sc-1');
    expect(result.protocol).toBe('SC-2024-0001');
    expect(result.warnings).toHaveLength(0);
  });

  it('trunca nome de arquivo longo para caber em documents.name (varchar 75), preservando extensão', async () => {
    const longName = `${'a'.repeat(120)}.pdf`;
    await service.createFromDocument(
      {
        doctorId: 'doctor-1',
        patientId: 'patient-1',
        procedureId: 'proc-1',
        tempStoragePath: 'sc-from-document-tmp/owner-1/doc.pdf',
        originalFileName: longName,
      },
      'user-1',
    );

    const { name } = documentsService.createFromPath.mock.calls[0][0];
    expect(name.length).toBeLessThanOrEqual(75);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('cria novo paciente quando newPatient é fornecido em vez de patientId', async () => {
    const result = await service.createFromDocument(
      {
        doctorId: 'doctor-1',
        newPatient: {
          name: 'Joao Silva',
          cpf: '123.456.789-01',
          birthDate: '1985-05-15',
          gender: 'M',
        },
        procedureId: 'proc-1',
      },
      'user-1',
    );

    expect(patientsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Joao Silva', cpf: '12345678901' }),
      'user-1',
      { manager },
    );
    expect(patientsService.sendWelcome).toHaveBeenCalledWith({
      id: 'patient-new',
    });
    expect(mutationService.createSurgeryRequest).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'patient-new' }),
      'user-1',
      { manager },
    );
    expect(result.id).toBe('sc-1');
  });

  it('lança BadRequestException quando CPF do novo paciente tem menos de 11 dígitos', async () => {
    await expect(
      service.createFromDocument(
        {
          doctorId: 'doctor-1',
          newPatient: {
            name: 'X',
            cpf: '123',
            birthDate: '1990-01-01',
            gender: 'F',
          },
          procedureId: 'proc-1',
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mutationService.createSurgeryRequest).not.toHaveBeenCalled();
  });

  it('lança BadRequestException quando nem patientId nem newPatient são fornecidos', async () => {
    await expect(
      service.createFromDocument(
        { doctorId: 'doctor-1', procedureId: 'proc-1' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cria a SC sem procedimento (via documento só exige paciente válido)', async () => {
    const result = await service.createFromDocument(
      { doctorId: 'doctor-1', patientId: 'patient-1' },
      'user-1',
    );

    expect(result.id).toBe('sc-1');
    expect(mutationService.createSurgeryRequest).toHaveBeenCalledWith(
      expect.objectContaining({ procedureId: undefined }),
      'user-1',
      { manager },
    );
  });

  it('acumula warning mas não falha quando mover o documento para storage falha', async () => {
    storage.move.mockRejectedValueOnce(new Error('storage timeout'));

    const result = await service.createFromDocument(
      {
        doctorId: 'doctor-1',
        patientId: 'patient-1',
        procedureId: 'proc-1',
        tempStoragePath: 'sc-from-document-tmp/owner-1/doc.pdf',
      },
      'user-1',
    );

    expect(result.id).toBe('sc-1');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('anexo');
  });

  it('não tenta mover documento quando tempStoragePath é undefined', async () => {
    await service.createFromDocument(
      { doctorId: 'doctor-1', patientId: 'patient-1', procedureId: 'proc-1' },
      'user-1',
    );

    expect(storage.move).not.toHaveBeenCalled();
    expect(documentsService.createFromPath).not.toHaveBeenCalled();
  });

  it('repassa address, healthPlanId e healthPlanNumber ao criar novo paciente', async () => {
    patientRepo.findOne.mockResolvedValue({
      id: 'patient-new',
      healthPlanId: null,
      healthPlanNumber: '88888 0167 4659 0018',
    });
    await service.createFromDocument(
      {
        doctorId: 'doctor-1',
        newPatient: {
          name: 'Joao Silva',
          cpf: '123.456.789-01',
          birthDate: '1985-05-15',
          gender: 'M',
          address: 'Rua das Flores, 123',
          healthPlanNumber: '88888 0167 4659 0018',
        },
        healthPlanId: 'hp-1',
        procedureId: 'proc-1',
      },
      'user-1',
    );

    expect(patientsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        address: 'Rua das Flores, 123',
        healthPlanNumber: '88888 0167 4659 0018',
      }),
      'user-1',
      { manager },
    );
    expect(patientRepo.update).toHaveBeenCalledWith(
      'patient-new',
      expect.objectContaining({ healthPlanId: 'hp-1' }),
    );
  });

  it('repassa endereço estruturado (número/complemento/bairro/cidade/UF/CEP) ao criar novo paciente', async () => {
    await service.createFromDocument(
      {
        doctorId: 'doctor-1',
        newPatient: {
          name: 'Lucas Bruno Borges de Medeiros',
          cpf: '168.508.057-03',
          address: 'Rua Guarajanga',
          addressNumber: '6',
          addressComplement: 'Q 6 01, Lt 13',
          neighborhood: 'Centro',
          city: 'Duque de Caxias',
          state: 'RJ',
          zipCode: '25220290',
        },
        procedureId: 'proc-1',
      },
      'user-1',
    );

    expect(patientsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        address: 'Rua Guarajanga',
        addressNumber: '6',
        addressComplement: 'Q 6 01, Lt 13',
        neighborhood: 'Centro',
        city: 'Duque de Caxias',
        state: 'RJ',
        zipCode: '25220290',
      }),
      'user-1',
      { manager },
    );
  });

  it('repassa sections ao assemblyService quando fornecidas', async () => {
    await service.createFromDocument(
      {
        doctorId: 'doctor-1',
        patientId: 'patient-1',
        procedureId: 'proc-1',
        sections: [
          { title: 'Histórico e Diagnóstico', description: 'Texto.' },
          { title: 'Conduta', description: 'Justificativa.' },
        ],
      },
      'user-1',
    );

    expect(assemblyService.assembleFromExtracted).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: [
          { title: 'Histórico e Diagnóstico', description: 'Texto.' },
          { title: 'Conduta', description: 'Justificativa.' },
        ],
      }),
    );
  });

  it('repassa quantity dos itens TUSS ao assemblyService', async () => {
    await service.createFromDocument(
      {
        doctorId: 'doctor-1',
        patientId: 'patient-1',
        procedureId: 'proc-1',
        tussItems: [
          {
            tussCode: '3.07.15.091',
            name: 'Descompressão cervical',
            quantity: 3,
          },
          { tussCode: '3.07.15.100' },
        ],
      },
      'user-1',
    );

    expect(assemblyService.assembleFromExtracted).toHaveBeenCalledWith(
      expect.objectContaining({
        tussItems: [
          expect.objectContaining({
            code: '3.07.15.091',
            description: 'Descompressão cervical',
            quantity: 3,
          }),
          expect.objectContaining({ code: '3.07.15.100', quantity: undefined }),
        ],
      }),
    );
  });

  it('divide supplier/manufacturer separados por vírgula em arrays', async () => {
    await service.createFromDocument(
      {
        doctorId: 'doctor-1',
        patientId: 'patient-1',
        procedureId: 'proc-1',
        opmeItems: [
          {
            description: 'Cânula',
            qty: 2,
            supplier: 'Sintex, BW Medic, Las Brasil',
            manufacturer: 'Marca A',
          },
        ],
      },
      'user-1',
    );

    expect(assemblyService.assembleFromExtracted).toHaveBeenCalledWith(
      expect.objectContaining({
        opmeItems: [
          expect.objectContaining({
            description: 'Cânula',
            qty: 2,
            suppliers: ['Sintex', 'BW Medic', 'Las Brasil'],
            manufacturers: ['Marca A'],
          }),
        ],
      }),
    );
  });

  it('propaga warnings do assemblyService', async () => {
    assemblyService.assembleFromExtracted.mockResolvedValueOnce({
      warnings: ['TUSS 9.99.99.999 (descrição não resolvida)'],
    });

    const result = await service.createFromDocument(
      { doctorId: 'doctor-1', patientId: 'patient-1', procedureId: 'proc-1' },
      'user-1',
    );

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('TUSS');
  });

  it('resolve/cria hospital e convênio por nome dentro da transação da SC', async () => {
    entityResolver.resolveOrCreateHospitalId.mockResolvedValue('h-new');
    entityResolver.resolveOrCreateHealthPlanId.mockResolvedValue('hp-new');

    await service.createFromDocument(
      {
        doctorId: 'doctor-1',
        patientId: 'patient-1',
        procedureId: 'proc-1',
        hospitalName: "Hospital Caxias D'Or",
        healthPlanName: 'SULAMERICA',
      },
      'user-1',
    );

    expect(entityResolver.resolveOrCreateHospitalId).toHaveBeenCalledWith(
      "Hospital Caxias D'Or",
      'owner-1',
      manager,
    );
    expect(entityResolver.resolveOrCreateHealthPlanId).toHaveBeenCalledWith(
      'SULAMERICA',
      'owner-1',
      manager,
    );
    expect(mutationService.createSurgeryRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        hospitalId: 'h-new',
        healthPlanId: 'hp-new',
      }),
      'user-1',
      { manager },
    );
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(mutationService.broadcastCreated).toHaveBeenCalledWith(
      'sc-1',
      'user-1',
    );
  });

  it('faz backfill de convênio/carteirinha no paciente existente quando informado', async () => {
    entityResolver.resolveOrCreateHealthPlanId.mockResolvedValue('hp-1');
    patientRepo.findOne.mockResolvedValue({
      id: 'patient-1',
      healthPlanId: null,
      healthPlanNumber: null,
    });

    await service.createFromDocument(
      {
        doctorId: 'doctor-1',
        patientId: 'patient-1',
        procedureId: 'proc-1',
        healthPlanName: 'SULAMERICA',
        healthPlanNumber: '88888 0167 4659 0018',
      },
      'user-1',
    );

    expect(patientRepo.update).toHaveBeenCalledWith(
      'patient-1',
      expect.objectContaining({
        healthPlanId: 'hp-1',
        healthPlanNumber: '88888 0167 4659 0018',
      }),
    );
  });

  it('resolve/cria procedimento por nome quando procedureId não é enviado', async () => {
    entityResolver.resolveOrCreateProcedureId.mockResolvedValue('proc-new');

    await service.createFromDocument(
      {
        doctorId: 'doctor-1',
        patientId: 'patient-1',
        procedureName: 'Artrodese Cervical C5-C6',
      },
      'user-1',
    );

    expect(mutationService.createSurgeryRequest).toHaveBeenCalledWith(
      expect.objectContaining({ procedureId: 'proc-new' }),
      'user-1',
      { manager },
    );
  });

  it('B1: recusa ids de outra clínica antes de qualquer escrita', async () => {
    mutationService.assertBelongsToOwner.mockRejectedValue(
      new NotFoundException('Hospital não encontrado'),
    );

    await expect(
      service.createFromDocument(
        {
          doctorId: 'doctor-1',
          newPatient: { name: 'Novo', cpf: '12345678901' },
          hospitalId: 'hosp-de-outra-clinica',
        } as any,
        'user-1',
      ),
    ).rejects.toThrow('Hospital não encontrado');

    expect(mutationService.assertBelongsToOwner).toHaveBeenCalledWith(
      expect.objectContaining({ hospitalId: 'hosp-de-outra-clinica' }),
      'owner-1',
    );
    expect(patientsService.create).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('falha na criação da SC desfaz os cadastros auxiliares (mesma transação) e não faz broadcast', async () => {
    mutationService.createSurgeryRequest.mockRejectedValue(new Error('boom'));
    entityResolver.resolveOrCreateHospitalId.mockResolvedValue('h-new');

    await expect(
      service.createFromDocument(
        {
          doctorId: 'doctor-1',
          patientId: 'patient-1',
          hospitalName: 'Hospital Novo',
        } as any,
        'user-1',
      ),
    ).rejects.toThrow('boom');

    expect(entityResolver.resolveOrCreateHospitalId).toHaveBeenCalledWith(
      'Hospital Novo',
      'owner-1',
      manager,
    );
    expect(mutationService.broadcastCreated).not.toHaveBeenCalled();
    expect(assemblyService.assembleFromExtracted).not.toHaveBeenCalled();
  });

  it('falha na criação da SC: novo paciente é gravado pelo manager da transação e não recebe boas-vindas', async () => {
    const order: string[] = [];
    patientsService.create.mockImplementation(async () => {
      order.push('patient');
      return { id: 'patient-new', phone: '11999999999' };
    });
    mutationService.createSurgeryRequest.mockRejectedValue(new Error('boom'));
    dataSource.transaction.mockImplementationOnce(async (cb: any) => {
      order.push('begin');
      try {
        return await cb(manager);
      } catch (err) {
        order.push('rollback');
        throw err;
      }
    });

    await expect(
      service.createFromDocument(
        {
          doctorId: 'doctor-1',
          newPatient: { name: 'Novo', cpf: '12345678901' },
          procedureId: 'proc-1',
        } as any,
        'user-1',
      ),
    ).rejects.toThrow('boom');

    expect(order).toEqual(['begin', 'patient', 'rollback']);
    expect(patientsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Novo' }),
      'user-1',
      { manager },
    );
    expect(patientsService.sendWelcome).not.toHaveBeenCalled();
    expect(mutationService.broadcastCreated).not.toHaveBeenCalled();
  });

  it('CPF inválido do novo paciente é recusado antes de abrir a transação', async () => {
    await expect(
      service.createFromDocument(
        {
          doctorId: 'doctor-1',
          newPatient: { name: 'Novo', cpf: '123' },
        } as any,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(patientsService.create).not.toHaveBeenCalled();
  });

  describe('applyDocumentExtraction', () => {
    it('rejeita um caminho temporário que não pertence ao tenant', async () => {
      surgeryRequestRepository.findOneSimple.mockResolvedValue({
        id: 'sc-1',
        status: 1,
      });

      await expect(
        service.applyDocumentExtraction(
          'sc-1',
          { tempStoragePath: 'sc-from-document-tmp/other-owner/document.pdf' },
          'user-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(storage.move).not.toHaveBeenCalled();
      expect(assemblyService.assembleFromExtracted).not.toHaveBeenCalled();
    });

    it('SC fora do alcance do usuário vira 404', async () => {
      surgeryRequestRepository.findOneSimple.mockResolvedValue(null);

      await expect(
        service.applyDocumentExtraction('sc-x', {}, 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(accessControl.buildSurgeryAccessWhere).toHaveBeenCalledWith(
        { id: 'sc-x' },
        'user-1',
      );
    });

    it('preenche a carteirinha pendente sem substituir o convênio existente', async () => {
      surgeryRequestRepository.findOneSimple.mockResolvedValue({
        id: 'sc-1',
        status: 1,
        patientId: 'patient-1',
        healthPlanId: 'hp-1',
        healthPlanRegistration: null,
      });
      patientRepo.findOne.mockResolvedValue({
        id: 'patient-1',
        healthPlanId: 'hp-1',
        healthPlanNumber: null,
      });

      await service.applyDocumentExtraction(
        'sc-1',
        { healthPlan: true, healthPlanNumber: '123456' },
        'user-1',
      );

      expect(surgeryRequestRepository.update).toHaveBeenCalledWith('sc-1', {
        healthPlanRegistration: '123456',
      });
      expect(patientRepo.update).toHaveBeenCalledWith('patient-1', {
        healthPlanNumber: '123456',
      });
    });
  });
});
