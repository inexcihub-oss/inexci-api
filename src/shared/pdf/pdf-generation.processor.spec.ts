import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bull';

import { PdfGenerationProcessor } from './pdf-generation.processor';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SurgeryRequestPdfAssemblyService } from 'src/modules/surgery-requests/services/surgery-request-pdf-assembly.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { ActivityType, SurgeryRequestActivity } from 'src/database/entities/surgery-request-activity.entity';

describe('PdfGenerationProcessor', () => {
  let processor: PdfGenerationProcessor;

  const mockSurgeryRequestRepository = {
    findOneWithAllRelations: jest.fn(),
  };
  const mockPdfAssemblyService = {
    generateLaudoPdf: jest.fn(),
  };
  const mockStorageService = {
    create: jest.fn(),
  };
  const mockActivityRepo = {
    save: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PdfGenerationProcessor,
        {
          provide: SurgeryRequestRepository,
          useValue: mockSurgeryRequestRepository,
        },
        {
          provide: SurgeryRequestPdfAssemblyService,
          useValue: mockPdfAssemblyService,
        },
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
        {
          provide: getRepositoryToken(SurgeryRequestActivity),
          useValue: mockActivityRepo,
        },
      ],
    }).compile();

    processor = module.get(PdfGenerationProcessor);
  });

  it('deve carregar relações completas de OPME ao gerar PDF histórico', async () => {
    const request = {
      id: 'sc-1',
      createdById: 'user-1',
      opmeItems: [
        {
          name: 'Kit OPME',
          quantity: 1,
          manufacturers: [{ name: 'Zimmer Biomet' }],
          suppliers: [{ name: 'Zimmer Biomet Brasil' }],
        },
      ],
    };

    mockSurgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
      request,
    );
    mockPdfAssemblyService.generateLaudoPdf.mockResolvedValue({
      pdf: Buffer.from('pdf-content').toString('base64'),
    });
    mockStorageService.create.mockResolvedValue('pdfs/solicitacao-sc-1.pdf');
    mockActivityRepo.save.mockResolvedValue(undefined);

    await processor.handleGeneratePdf({
      data: { surgeryRequestId: 'sc-1', userId: 'user-1' },
    } as Job);

    expect(
      mockSurgeryRequestRepository.findOneWithAllRelations,
    ).toHaveBeenCalledWith({ id: 'sc-1' });
    expect(mockPdfAssemblyService.generateLaudoPdf).toHaveBeenCalledWith(
      request,
      'user-1',
    );
    expect(mockActivityRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        surgeryRequestId: 'sc-1',
        type: ActivityType.PDF_GENERATED,
      }),
    );
  });
});
