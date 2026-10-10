import { Reflector } from '@nestjs/core';
import { Type } from '@nestjs/common';
import { Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { SurgeryRequestsController } from './surgery-requests.controller';
import { CidController } from './cid/cid.controller';
import { ActivitiesController } from './activities/activities.controller';
import { DocumentsController } from './documents/documents.controller';
import { OpmeController } from './opme/opme.controller';
import { PendenciesController } from './pendencies/pendencies.controller';
import { SurgeryRequestProceduresController } from './procedures/procedures.controller';
import { ReportsController } from '../reports/reports.controller';

describe('Permissões declaradas no módulo de SC', () => {
  const reflector = new Reflector();

  it('exige solicitações no controller inteiro', () => {
    expect(reflector.get(PERMISSIONS_KEY, SurgeryRequestsController)).toEqual([
      Permission.SOLICITACOES,
    ]);
  });

  it('deixa available-doctors aberto a qualquer autenticado', () => {
    expect(
      reflector.get(
        PERMISSIONS_KEY,
        SurgeryRequestsController.prototype.getAvailableDoctors,
      ),
    ).toEqual([]);
  });

  it('abre findAll para SOLICITACOES ou ATENDIMENTO', () => {
    expect(
      reflector.get(
        PERMISSIONS_KEY,
        SurgeryRequestsController.prototype.findAll,
      ),
    ).toEqual([Permission.SOLICITACOES, Permission.ATENDIMENTO]);
  });

  it('não exige solicitações na busca de CID', () => {
    expect(reflector.get(PERMISSIONS_KEY, CidController)).toBeUndefined();
  });

  const demaisControllersDeSC: Array<[string, Type<unknown>]> = [
    ['ActivitiesController', ActivitiesController],
    ['DocumentsController', DocumentsController],
    ['OpmeController', OpmeController],
    ['PendenciesController', PendenciesController],
    ['SurgeryRequestProceduresController', SurgeryRequestProceduresController],
    ['ReportsController', ReportsController],
  ];

  it.each(demaisControllersDeSC)(
    'exige solicitações no controller inteiro: %s',
    (_nome, ControllerClass) => {
      expect(reflector.get(PERMISSIONS_KEY, ControllerClass)).toEqual([
        Permission.SOLICITACOES,
      ]);
    },
  );
});

describe('SurgeryRequestsController', () => {
  let surgeryRequestsService: any;
  let workflowService: any;
  let fromDocumentService: any;
  let documentExtractionJobsService: any;
  let controller: SurgeryRequestsController;

  beforeEach(() => {
    surgeryRequestsService = {
      createSurgeryRequest: jest.fn(),
    };
    workflowService = {
      sendRequest: jest.fn().mockResolvedValue({ sent: true }),
      closeSurgeryRequest: jest.fn().mockResolvedValue(undefined),
    };
    fromDocumentService = {
      createFromDocument: jest.fn(),
    };
    documentExtractionJobsService = {
      enqueue: jest
        .fn()
        .mockResolvedValue({ jobId: 'job-1', status: 'processing' }),
      getStatus: jest.fn().mockResolvedValue({ status: 'processing' }),
    };

    controller = new SurgeryRequestsController(
      surgeryRequestsService,
      workflowService,
      fromDocumentService,
      documentExtractionJobsService,
    );
  });

  it('enfileira extração e retorna jobId/status', async () => {
    const file = {
      originalname: 'doc.pdf',
      mimetype: 'application/pdf',
      size: 100,
      buffer: Buffer.from('abc'),
    } as Express.Multer.File;

    const result = await controller.extractFromDocument(file, {
      userId: 'user-1',
    } as any);

    expect(documentExtractionJobsService.enqueue).toHaveBeenCalledWith(
      file,
      'user-1',
    );
    expect(result).toEqual({ jobId: 'job-1', status: 'processing' });
  });

  it('repassa surgeryRequestId ao enfileirar extração para completar uma SC existente', async () => {
    const file = {
      originalname: 'doc.pdf',
      mimetype: 'application/pdf',
      size: 100,
      buffer: Buffer.from('abc'),
    } as Express.Multer.File;

    await controller.extractFromDocument(
      file,
      { userId: 'user-1' } as any,
      undefined,
      'sc-123',
    );

    expect(documentExtractionJobsService.enqueue).toHaveBeenCalledWith(
      file,
      'user-1',
      { surgeryRequestId: 'sc-123' },
    );
  });

  it('consulta status do job com escopo do usuário autenticado', async () => {
    const result = await controller.getExtractFromDocumentStatus('job-1', {
      userId: 'user-1',
    } as any);

    expect(documentExtractionJobsService.getStatus).toHaveBeenCalledWith(
      'job-1',
      'user-1',
    );
    expect(result).toEqual({ status: 'processing' });
  });

  it('ações de workflow vão direto ao SurgeryRequestWorkflowService (rotas inalteradas)', async () => {
    const user = { userId: 'user-1' } as any;
    await controller.sendRequest('sc-1', { method: 'download' } as any, user);
    await controller.closeSurgeryRequest('sc-1', { reason: 'x' }, user);

    expect(workflowService.sendRequest).toHaveBeenCalledWith(
      'sc-1',
      { method: 'download' },
      'user-1',
    );
    expect(workflowService.closeSurgeryRequest).toHaveBeenCalledWith(
      'sc-1',
      { reason: 'x' },
      'user-1',
    );
  });
});
