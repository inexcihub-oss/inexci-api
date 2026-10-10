import { NotFoundException } from '@nestjs/common';

import { AuthorizationHandler } from './authorization.handler';
import { SendMethod } from 'src/shared/constants/send-method';
import { STORAGE_FOLDERS } from 'src/config/storage.config';
import { ActivityType } from 'src/database/entities/surgery-request-activity.entity';
import { ContestationTypeEnum } from 'src/database/entities/contestation.entity';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';

const PDF = Buffer.from('pdf-gerado');
const SALVO = Buffer.from('pdf-salvo');
const DATA_CONTESTACAO = new Date('2026-10-01T10:00:00Z');

function criarHandler() {
  const manager = {
    getRepository: jest.fn(() => ({
      save: jest.fn().mockResolvedValue({ id: 'contest-1' }),
      update: jest.fn().mockResolvedValue({}),
    })),
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: unknown) => Promise<unknown>) => cb(manager)),
  };
  const request = {
    id: 'req-1',
    ownerId: 'owner-1',
    protocol: 'P-1',
    status: SurgeryRequestStatus.IN_ANALYSIS,
    patient: { name: 'Paciente' },
  };
  const mailService = { sendSurgeryContested: jest.fn() };
  const storageService = {
    create: jest.fn().mockResolvedValue('pdfs/owner-1/arquivo.pdf'),
    download: jest.fn().mockResolvedValue(SALVO),
  };
  const surgeryRequestRepository = {
    findOneForWorkflow: jest.fn().mockResolvedValue(request),
    findOneWithAllRelations: jest.fn().mockResolvedValue(request),
  };
  const activityRepository = {
    create: jest.fn().mockResolvedValue({}),
    findByTypeSince: jest.fn().mockResolvedValue([]),
  };
  const contestationRepository = {
    findLatestBySurgeryRequest: jest.fn().mockResolvedValue(null),
  };
  const notificationService = {
    notifyAdminsOfWorkflowAction: jest.fn(),
  };
  const pdfAssemblyService = {
    generateContestAuthorizationPdf: jest.fn().mockResolvedValue(PDF),
  };
  const eventEmitter = { emit: jest.fn() };

  const handler = new AuthorizationHandler(
    dataSource as any,
    mailService as any,
    storageService as any,
    surgeryRequestRepository as any,
    activityRepository as any,
    contestationRepository as any,
    notificationService as any,
    pdfAssemblyService as any,
    { assertCanAdvance: jest.fn() } as any,
    eventEmitter as any,
  );

  return {
    handler,
    dataSource,
    request,
    mailService,
    storageService,
    surgeryRequestRepository,
    activityRepository,
    contestationRepository,
    notificationService,
    pdfAssemblyService,
  };
}

function atividadePdf(contestationId: string, pdfPath: string) {
  return {
    content: JSON.stringify({
      description: 'PDF de contestação de autorização gerado',
      pdf_path: pdfPath,
      contestation_id: contestationId,
    }),
  };
}

describe('AuthorizationHandler — PDF de contestação', () => {
  describe('contestAuthorization', () => {
    it('no método documento gera, salva e registra a atividade uma única vez, depois do commit', async () => {
      const ctx = criarHandler();

      const result = await ctx.handler.contestAuthorization(
        'req-1',
        { reason: 'Negado', method: SendMethod.DOCUMENT },
        'user-1',
      );

      expect(result).toEqual({ sent: false, method: SendMethod.DOCUMENT });
      expect(
        ctx.pdfAssemblyService.generateContestAuthorizationPdf,
      ).toHaveBeenCalledTimes(1);
      expect(ctx.storageService.create).toHaveBeenCalledTimes(1);
      expect(ctx.storageService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mimetype: 'application/pdf',
          buffer: PDF,
        }),
        STORAGE_FOLDERS.PDFS,
        'owner-1',
      );
      expect(ctx.activityRepository.create).toHaveBeenCalledTimes(1);
      const atividade = ctx.activityRepository.create.mock.calls[0][0];
      expect(atividade.type).toBe(ActivityType.PDF_GENERATED);
      expect(JSON.parse(atividade.content)).toEqual(
        expect.objectContaining({
          pdf_path: 'pdfs/owner-1/arquivo.pdf',
          contestation_id: 'contest-1',
        }),
      );
      expect(
        ctx.dataSource.transaction.mock.invocationCallOrder[0],
      ).toBeLessThan(ctx.storageService.create.mock.invocationCallOrder[0]);
    });

    it('falha ao salvar o PDF não derruba a contestação', async () => {
      const ctx = criarHandler();
      ctx.storageService.create.mockRejectedValue(new Error('R2 fora'));

      await expect(
        ctx.handler.contestAuthorization(
          'req-1',
          { reason: 'Negado', method: SendMethod.DOCUMENT },
          'user-1',
        ),
      ).resolves.toEqual({ sent: false, method: SendMethod.DOCUMENT });
      expect(ctx.activityRepository.create).not.toHaveBeenCalled();
    });

    it('no método e-mail anexa o PDF sem gravar no storage nem registrar atividade', async () => {
      const ctx = criarHandler();

      const result = await ctx.handler.contestAuthorization(
        'req-1',
        { reason: 'Negado', method: SendMethod.EMAIL, to: 'plano@x.com' },
        'user-1',
      );

      expect(result).toEqual({ sent: true, method: SendMethod.EMAIL });
      expect(ctx.mailService.sendSurgeryContested).toHaveBeenCalledWith(
        'plano@x.com',
        expect.any(String),
        expect.any(Object),
        [expect.objectContaining({ content: PDF.toString('base64') })],
        undefined,
      );
      expect(ctx.storageService.create).not.toHaveBeenCalled();
      expect(ctx.activityRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('generateContestAuthorizationPdf', () => {
    it('devolve o PDF salvo da contestação vigente sem gravar nada', async () => {
      const ctx = criarHandler();
      ctx.contestationRepository.findLatestBySurgeryRequest.mockResolvedValue({
        id: 'contest-2',
        createdAt: DATA_CONTESTACAO,
      });
      ctx.activityRepository.findByTypeSince.mockResolvedValue([
        atividadePdf('contest-2', 'pdfs/owner-1/vigente.pdf'),
      ]);

      const buffer = await ctx.handler.generateContestAuthorizationPdf(
        'req-1',
        'user-1',
      );

      expect(buffer).toBe(SALVO);
      expect(
        ctx.contestationRepository.findLatestBySurgeryRequest,
      ).toHaveBeenCalledWith('req-1', ContestationTypeEnum.AUTHORIZATION);
      expect(ctx.activityRepository.findByTypeSince).toHaveBeenCalledWith(
        'req-1',
        ActivityType.PDF_GENERATED,
        DATA_CONTESTACAO,
      );
      expect(ctx.storageService.download).toHaveBeenCalledWith(
        'pdfs/owner-1/vigente.pdf',
      );
      expect(
        ctx.pdfAssemblyService.generateContestAuthorizationPdf,
      ).not.toHaveBeenCalled();
      expect(ctx.storageService.create).not.toHaveBeenCalled();
      expect(ctx.activityRepository.create).not.toHaveBeenCalled();
    });

    it('ignora PDF de outra contestação e gera em memória sem gravar', async () => {
      const ctx = criarHandler();
      ctx.contestationRepository.findLatestBySurgeryRequest.mockResolvedValue({
        id: 'contest-2',
        createdAt: DATA_CONTESTACAO,
      });
      ctx.activityRepository.findByTypeSince.mockResolvedValue([
        atividadePdf('contest-1', 'pdfs/owner-1/antiga.pdf'),
        { content: 'texto livre' },
      ]);

      const buffer = await ctx.handler.generateContestAuthorizationPdf(
        'req-1',
        'user-1',
      );

      expect(buffer).toBe(PDF);
      expect(ctx.storageService.download).not.toHaveBeenCalled();
      expect(ctx.storageService.create).not.toHaveBeenCalled();
      expect(ctx.activityRepository.create).not.toHaveBeenCalled();
    });

    it('sem PDF salvo gera em memória sem gravar nada', async () => {
      const ctx = criarHandler();

      const buffer = await ctx.handler.generateContestAuthorizationPdf(
        'req-1',
        'user-1',
      );

      expect(buffer).toBe(PDF);
      expect(
        ctx.pdfAssemblyService.generateContestAuthorizationPdf,
      ).toHaveBeenCalledWith(ctx.request, 'req-1', 'user-1');
      expect(ctx.storageService.create).not.toHaveBeenCalled();
      expect(ctx.activityRepository.create).not.toHaveBeenCalled();
    });

    it('quando o objeto salvo sumiu do storage gera em memória', async () => {
      const ctx = criarHandler();
      ctx.contestationRepository.findLatestBySurgeryRequest.mockResolvedValue({
        id: 'contest-2',
        createdAt: DATA_CONTESTACAO,
      });
      ctx.activityRepository.findByTypeSince.mockResolvedValue([
        atividadePdf('contest-2', 'pdfs/owner-1/vigente.pdf'),
      ]);
      ctx.storageService.download.mockResolvedValue(null);

      await expect(
        ctx.handler.generateContestAuthorizationPdf('req-1', 'user-1'),
      ).resolves.toBe(PDF);
      expect(ctx.storageService.create).not.toHaveBeenCalled();
    });

    it('lança 404 quando a solicitação não existe', async () => {
      const ctx = criarHandler();
      ctx.surgeryRequestRepository.findOneWithAllRelations.mockResolvedValue(
        null,
      );

      await expect(
        ctx.handler.generateContestAuthorizationPdf('req-x', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
