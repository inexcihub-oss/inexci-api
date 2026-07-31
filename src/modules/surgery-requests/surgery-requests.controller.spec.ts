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
import { ProceduresController } from './procedures/procedures.controller';
import { ReportsController } from '../reports/reports.controller';

describe('Permissões declaradas no módulo de SC', () => {
  const reflector = new Reflector();

  it('exige solicitações no controller inteiro', () => {
    expect(reflector.get(PERMISSIONS_KEY, SurgeryRequestsController)).toEqual(
      [Permission.SOLICITACOES],
    );
  });

  /** A agenda usa este endpoint para o filtro de médico. */
  it('deixa available-doctors aberto a qualquer autenticado', () => {
    expect(
      reflector.get(
        PERMISSIONS_KEY,
        SurgeryRequestsController.prototype.getAvailableDoctors,
      ),
    ).toEqual([]);
  });

  /**
   * Ponte deliberada: quem atende vê as cirurgias do paciente que está
   * atendendo (aba Histórico / timeline), mas não navega a carteira
   * cirúrgica da clínica. A metade que o decorator não consegue expressar
   * (exigir `patientId` quando falta SOLICITACOES) é responsabilidade do
   * `SurgeryRequestsService.findAll`.
   */
  it('abre findAll para SOLICITACOES ou ATENDIMENTO', () => {
    expect(
      reflector.get(
        PERMISSIONS_KEY,
        SurgeryRequestsController.prototype.findAll,
      ),
    ).toEqual([Permission.SOLICITACOES, Permission.ATENDIMENTO]);
  });

  /** O CidPicker da ficha de atendimento consome este controller. */
  it('não exige solicitações na busca de CID', () => {
    expect(reflector.get(PERMISSIONS_KEY, CidController)).toBeUndefined();
  });

  const demaisControllersDeSC: Array<[string, Type<unknown>]> = [
    ['ActivitiesController', ActivitiesController],
    ['DocumentsController', DocumentsController],
    ['OpmeController', OpmeController],
    ['PendenciesController', PendenciesController],
    ['ProceduresController', ProceduresController],
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
  let fromDocumentService: any;
  let documentExtractionJobsService: any;
  let controller: SurgeryRequestsController;

  beforeEach(() => {
    surgeryRequestsService = {
      createSurgeryRequest: jest.fn(),
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
});
