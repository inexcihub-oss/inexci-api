import { BadRequestException } from '@nestjs/common';
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

describe('SurgeryRequestFromDocumentService', () => {
  let extractor: any;
  let storage: any;
  let accessControl: any;
  let patientsService: any;
  let surgeryRequestsService: any;
  let mutationService: any;
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
      }),
    };
    storage = {
      uploadBuffer: jest
        .fn()
        .mockResolvedValue('sc-from-document-tmp/uuid.pdf'),
      move: jest.fn().mockResolvedValue('documents/owner-1/uuid.pdf'),
    };
    accessControl = {
      getOwnerId: jest.fn().mockResolvedValue('owner-1'),
    };
    patientsService = {
      create: jest.fn().mockResolvedValue({ id: 'patient-new' }),
    };
    surgeryRequestsService = {
      createReportSection: jest.fn().mockResolvedValue({}),
    };
    mutationService = {
      createSurgeryRequest: jest
        .fn()
        .mockResolvedValue({ id: 'sc-1', protocol: 'SC-2024-0001' }),
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
    };
    documentsService = {
      createFromPath: jest.fn().mockResolvedValue({ id: 'doc-1' }),
    };
    configService = {
      get: jest.fn().mockReturnValue(10 * 1024 * 1024),
    };
    dataSource = {
      getRepository: jest.fn(),
    };

    service = new SurgeryRequestFromDocumentService(
      extractor,
      storage,
      accessControl,
      patientsService,
      surgeryRequestsService,
      mutationService,
      assemblyService,
      entityResolver,
      documentsService,
      configService,
      dataSource,
    );
  });

  // ─────────────────────────────────────────────
  // extractFromDocument
  // ─────────────────────────────────────────────

  it('extrai e retorna DTO completo com candidatos e tempStoragePath', async () => {
    const result = await service.extractFromDocument(buildFile(), 'user-1');

    expect(extractor.extractFromBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        buffer: expect.any(Buffer),
        mimeType: 'application/pdf',
        filename: 'laudo.pdf',
        intent: 'create_sc',
      }),
    );
    expect(storage.uploadBuffer).toHaveBeenCalled();
    expect(entityResolver.resolveCandidates).toHaveBeenCalled();
    expect(result.kind).toBe('medical_report');
    expect(result.confidence).toBeCloseTo(0.88);
    expect(result.patientMatchedByCpf).toBe(true);
    expect(result.candidates.patient).toHaveLength(1);
    expect(result.tempStoragePath).toBe('sc-from-document-tmp/uuid.pdf');
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

  // ─────────────────────────────────────────────
  // createFromDocument
  // ─────────────────────────────────────────────

  it('cria SC com paciente existente e retorna id+protocol', async () => {
    const result = await service.createFromDocument(
      {
        doctorId: 'doctor-1',
        patientId: 'patient-1',
        procedureId: 'proc-1',
        tempStoragePath: 'sc-from-document-tmp/doc.pdf',
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
    );
    expect(assemblyService.assembleFromExtracted).toHaveBeenCalledWith(
      expect.objectContaining({ scId: 'sc-1' }),
    );
    expect(storage.move).toHaveBeenCalledWith(
      'sc-from-document-tmp/doc.pdf',
      'documents/owner-1',
    );
    expect(documentsService.createFromPath).toHaveBeenCalledWith(
      expect.objectContaining({ surgeryRequestId: 'sc-1', name: 'laudo.pdf' }),
    );
    expect(result.id).toBe('sc-1');
    expect(result.protocol).toBe('SC-2024-0001');
    expect(result.warnings).toHaveLength(0);
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
    );
    expect(mutationService.createSurgeryRequest).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'patient-new' }),
      'user-1',
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

  it('lança BadRequestException quando procedureId não é fornecido', async () => {
    await expect(
      service.createFromDocument(
        { doctorId: 'doctor-1', patientId: 'p-1' } as any,
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('acumula warning mas não falha quando mover o documento para storage falha', async () => {
    storage.move.mockRejectedValueOnce(new Error('storage timeout'));

    const result = await service.createFromDocument(
      {
        doctorId: 'doctor-1',
        patientId: 'patient-1',
        procedureId: 'proc-1',
        tempStoragePath: 'sc-from-document-tmp/doc.pdf',
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
        healthPlanId: 'hp-1',
      }),
      'user-1',
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

  it('resolve/cria hospital e convênio por nome quando IDs não são enviados', async () => {
    const hospitalQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'h-new' }),
    };
    const healthPlanQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'hp-new' }),
    };
    const patientRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    };
    dataSource.getRepository.mockImplementation((entity: any) => {
      if (entity?.name === 'Hospital') {
        return {
          createQueryBuilder: () => hospitalQb,
          create: jest.fn((v: any) => v),
          save: jest.fn(async (v: any) => ({ id: 'h-new', ...v })),
        };
      }
      if (entity?.name === 'HealthPlan') {
        return {
          createQueryBuilder: () => healthPlanQb,
          create: jest.fn((v: any) => v),
          save: jest.fn(async (v: any) => ({ id: 'hp-new', ...v })),
        };
      }
      return patientRepo;
    });

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

    expect(mutationService.createSurgeryRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        hospitalId: 'h-new',
        healthPlanId: 'hp-new',
      }),
      'user-1',
    );
  });

  it('faz backfill de convênio/carteirinha no paciente existente quando informado', async () => {
    const hospitalRepo = {
      createQueryBuilder: () => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      }),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => ({ id: 'h-new', ...v })),
    };
    const healthPlanRepo = {
      createQueryBuilder: () => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'hp-1' }),
      }),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => ({ id: 'hp-1', ...v })),
    };
    const patientRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'patient-1',
        healthPlanId: null,
        healthPlanNumber: null,
      }),
      update: jest.fn().mockResolvedValue({}),
    };

    dataSource.getRepository.mockImplementation((entity: any) => {
      if (entity?.name === 'Hospital') return hospitalRepo;
      if (entity?.name === 'HealthPlan') return healthPlanRepo;
      return patientRepo;
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
    const procedureQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'proc-new' }),
    };

    dataSource.getRepository.mockImplementation((entity: any) => {
      if (entity?.name === 'Procedure') {
        return {
          createQueryBuilder: () => procedureQb,
          create: jest.fn((v: any) => v),
          save: jest.fn(async (v: any) => ({ id: 'proc-new', ...v })),
        };
      }
      return {
        createQueryBuilder: () => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(null),
        }),
        findOne: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      };
    });

    await service.createFromDocument(
      {
        doctorId: 'doctor-1',
        patientId: 'patient-1',
        procedureName: 'Artrodese Cervical C5-C6',
      },
      'user-1',
    );

    expect(mutationService.createSurgeryRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        procedureId: 'proc-new',
      }),
      'user-1',
    );
  });

  it('não tenta criar procedimento quando nome excede 255 chars e retorna BadRequest', async () => {
    const longName = 'A'.repeat(256);

    await expect(
      service.createFromDocument(
        {
          doctorId: 'doctor-1',
          patientId: 'patient-1',
          procedureName: longName,
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mutationService.createSurgeryRequest).not.toHaveBeenCalled();
  });
});
