import { buildManageTools } from './manage.tools';
import { ToolContext } from './tool.interface';
import { SurgeryRequestStatus } from '../../../database/entities/surgery-request.entity';

const mockTussRepository = {
  delete: jest.fn(),
};
const mockOpmeRepository = {
  remove: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  find: jest.fn(),
};
const mockDocumentRepository = {
  delete: jest.fn(),
};

const mockSurgeryRequestRepo = {
  findOneSimple: jest.fn(),
  update: jest.fn(),
};
const mockSurgeryRequestsService = {
  setHasOpme: jest.fn(),
};
const mockActivityRepo = { create: jest.fn() };
const mockTussItemRepo = {
  findMany: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  getRepository: () => mockTussRepository,
};
const mockOpmeItemRepo = {
  findByIdWithSuppliers: jest.fn(),
  saveWithSuppliers: jest.fn(),
  getRepository: () => mockOpmeRepository,
};
const mockDocumentRepo = {
  findOne: jest.fn(),
  findMany: jest.fn(),
  create: jest.fn(),
  getRepository: () => mockDocumentRepository,
};
const mockSupplierRepo = { findMany: jest.fn(), create: jest.fn() };
const mockHealthPlanRepo = { findOne: jest.fn() };
const mockStorageService = { create: jest.fn() };
const mockConfigService = { get: jest.fn() };

const baseContext: ToolContext = {
  userId: 'user-1',
  phone: '+5511999999999',
  accessibleDoctorIds: ['doctor-1'],
  conversationId: 'conv-1',
};

const pendingRequest = {
  id: 'req-1',
  protocol: 'SC-0042',
  doctorId: 'doctor-1',
  ownerId: 'owner-1',
  status: SurgeryRequestStatus.PENDING,
};

const sentRequest = {
  ...pendingRequest,
  status: SurgeryRequestStatus.SENT,
};

describe('ManageTools', () => {
  const tools = buildManageTools(
    mockSurgeryRequestRepo as any,
    mockSurgeryRequestsService as any,
    mockActivityRepo as any,
    mockTussItemRepo as any,
    mockOpmeItemRepo as any,
    mockDocumentRepo as any,
    mockSupplierRepo as any,
    mockHealthPlanRepo as any,
    mockStorageService as any,
    mockConfigService as any,
  );

  const getTool = (name: string) => tools.find((t) => t.name === name)!;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(pendingRequest);
    mockConfigService.get.mockReturnValue('');
    mockTussItemRepo.findMany.mockResolvedValue([]);
    mockDocumentRepo.findMany.mockResolvedValue([]);
    mockOpmeRepository.find.mockResolvedValue([]);
    mockSupplierRepo.findMany.mockResolvedValue([]);
    mockSupplierRepo.create.mockImplementation((dto: any) =>
      Promise.resolve({ id: `sup-${dto.name}`, name: dto.name }),
    );
  });

  describe('manage_tuss_items', () => {
    it('deve listar TUSS quando operation=list', async () => {
      mockTussItemRepo.findMany.mockResolvedValue([
        { id: 't1', tussCode: '30401010', name: 'Artroscopia', quantity: 1 },
      ]);

      const result = await getTool('manage_tuss_items').execute(
        { surgeryRequestId: 'req-1', operation: 'list' },
        baseContext,
      );

      expect(result).toContain('30401010');
      expect(result).toContain('Artroscopia');
    });

    it('deve exigir confirmação ao adicionar', async () => {
      const result = await getTool('manage_tuss_items').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'add',
          tussCode: '30401010',
          name: 'Artroscopia',
        },
        baseContext,
      );

      expect(result).toContain('Confirme');
      expect(mockTussItemRepo.create).not.toHaveBeenCalled();
    });

    it('deve adicionar TUSS quando confirm=true', async () => {
      mockTussItemRepo.create.mockResolvedValue({ id: 't-new' });

      const result = await getTool('manage_tuss_items').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'add',
          tussCode: '30401010',
          name: 'Artroscopia',
          quantity: 2,
          confirm: true,
        },
        baseContext,
      );

      expect(mockTussItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tussCode: '30401010',
          name: 'Artroscopia',
          quantity: 2,
        }),
      );
      expect(result).toContain('adicionado');
    });

    it('deve bloquear remoção quando SC não está em Pendente', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(sentRequest);
      mockTussItemRepo.findOne.mockResolvedValue({
        id: 't1',
        surgeryRequestId: 'req-1',
        tussCode: '30401010',
        name: 'Artroscopia',
        quantity: 1,
      });

      const result = await getTool('manage_tuss_items').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'remove',
          tussItemId: 't1',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('histórico');
      expect(result).toContain('Enviada');
      expect(mockTussRepository.delete).not.toHaveBeenCalled();
    });

    it('deve bloquear add quando SC não está em Pendente', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(sentRequest);

      const result = await getTool('manage_tuss_items').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'add',
          tussCode: '30401010',
          name: 'Artroscopia',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('histórico');
      expect(mockTussItemRepo.create).not.toHaveBeenCalled();
    });

    it('deve bloquear update quando SC não está em Pendente', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(sentRequest);
      mockTussItemRepo.findOne.mockResolvedValue({
        id: 't1',
        surgeryRequestId: 'req-1',
        tussCode: '30401010',
        name: 'Artroscopia',
        quantity: 1,
      });

      const result = await getTool('manage_tuss_items').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'update',
          tussItemId: 't1',
          quantity: 2,
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('histórico');
      expect(mockTussItemRepo.update).not.toHaveBeenCalled();
    });

    it('deve remover TUSS quando SC está em Pendente e confirm=true', async () => {
      mockTussItemRepo.findOne.mockResolvedValue({
        id: 't1',
        surgeryRequestId: 'req-1',
        tussCode: '30401010',
        name: 'Artroscopia',
        quantity: 1,
      });

      const result = await getTool('manage_tuss_items').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'remove',
          tussItemId: 't1',
          confirm: true,
        },
        baseContext,
      );

      expect(mockTussRepository.delete).toHaveBeenCalledWith({ id: 't1' });
      expect(result).toContain('removido');
    });
  });

  describe('manage_opme_items', () => {
    it('deve exigir 3 fabricantes ao adicionar', async () => {
      const result = await getTool('manage_opme_items').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'add',
          name: 'Parafuso',
          manufacturerNames: ['Fab 1', 'Fab 2'],
          supplierNames: ['F1', 'F2', 'F3'],
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('3 fabricantes');
    });

    it('deve adicionar OPME quando dados completos', async () => {
      mockOpmeRepository.create.mockReturnValue({ id: 'o-new' });
      mockOpmeRepository.save.mockResolvedValue({ id: 'o-new' });

      const result = await getTool('manage_opme_items').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'add',
          name: 'Parafuso',
          manufacturerNames: ['Fab 1', 'Fab 2', 'Fab 3'],
          supplierNames: ['F1', 'F2', 'F3'],
          confirm: true,
        },
        baseContext,
      );

      expect(mockSurgeryRequestsService.setHasOpme).toHaveBeenCalledWith(
        'req-1',
        true,
        'user-1',
      );
      expect(mockOpmeRepository.save).toHaveBeenCalled();
      expect(result).toContain('adicionado');
    });

    it('deve bloquear remoção quando SC não está em Pendente', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(sentRequest);
      mockOpmeItemRepo.findByIdWithSuppliers.mockResolvedValue({
        id: 'o1',
        surgeryRequestId: 'req-1',
        name: 'Parafuso',
        suppliers: [],
      });

      const result = await getTool('manage_opme_items').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'remove',
          opmeItemId: 'o1',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('histórico');
      expect(mockOpmeRepository.remove).not.toHaveBeenCalled();
    });

    it('deve bloquear add quando SC não está em Pendente', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(sentRequest);

      const result = await getTool('manage_opme_items').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'add',
          name: 'Parafuso',
          manufacturerNames: ['Fab 1', 'Fab 2', 'Fab 3'],
          supplierNames: ['F1', 'F2', 'F3'],
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('histórico');
      expect(mockOpmeRepository.save).not.toHaveBeenCalled();
    });

    it('deve remover OPME quando SC está em Pendente', async () => {
      mockOpmeItemRepo.findByIdWithSuppliers.mockResolvedValue({
        id: 'o1',
        surgeryRequestId: 'req-1',
        name: 'Parafuso',
        suppliers: [{ id: 's1' }],
      });

      const result = await getTool('manage_opme_items').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'remove',
          opmeItemId: 'o1',
          confirm: true,
        },
        baseContext,
      );

      expect(mockOpmeItemRepo.saveWithSuppliers).toHaveBeenCalled();
      expect(mockOpmeRepository.remove).toHaveBeenCalled();
      expect(result).toContain('removido');
    });
  });

  describe('manage_documents', () => {
    it('deve listar somente documentos que não são imagens do laudo', async () => {
      mockDocumentRepo.findMany.mockResolvedValue([
        {
          id: 'd1',
          name: 'Laudo.pdf',
          type: 'medical_report',
          key: 'doctorRequest',
          createdAt: new Date('2025-01-01'),
        },
        {
          id: 'd2',
          name: 'Imagem.jpg',
          type: 'exam_image',
          key: 'report_images',
          createdAt: new Date('2025-01-01'),
        },
      ]);

      const result = await getTool('manage_documents').execute(
        { surgeryRequestId: 'req-1', operation: 'list' },
        baseContext,
      );

      expect(result).toContain('Laudo.pdf');
      expect(result).not.toContain('Imagem.jpg');
    });

    it('deve bloquear attach quando não há mídia', async () => {
      const result = await getTool('manage_documents').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'attach',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('Não identifiquei nenhum arquivo');
    });

    it('deve anexar documento quando há mídia inbound', async () => {
      const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'application/pdf' },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as any);

      mockStorageService.create.mockResolvedValue('documents/doc-1.pdf');
      mockDocumentRepo.create.mockResolvedValue({ id: 'd-new' });

      const result = await getTool('manage_documents').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'attach',
          documentName: 'Laudo',
          confirm: true,
        },
        {
          ...baseContext,
          inboundMedia: [
            {
              url: 'https://api.twilio.com/2010-04-01/media/1',
              contentType: 'application/pdf',
            },
          ],
        },
      );

      expect(mockStorageService.create).toHaveBeenCalled();
      expect(mockDocumentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'medical_report',
          key: 'medical_report',
        }),
      );
      expect(result).toContain('anexado');

      fetchMock.mockRestore();
    });

    it('deve impedir remover imagem do laudo via manage_documents', async () => {
      mockDocumentRepo.findOne.mockResolvedValue({
        id: 'd2',
        name: 'Imagem.jpg',
        key: 'report_images',
        type: 'exam_image',
        surgeryRequestId: 'req-1',
      });

      const result = await getTool('manage_documents').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'remove',
          documentId: 'd2',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('manage_report_images');
      expect(mockDocumentRepository.delete).not.toHaveBeenCalled();
    });

    it('deve remover documento quando confirm=true', async () => {
      mockDocumentRepo.findOne.mockResolvedValue({
        id: 'd1',
        name: 'Laudo.pdf',
        key: 'doctorRequest',
        type: 'medical_report',
        surgeryRequestId: 'req-1',
      });

      const result = await getTool('manage_documents').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'remove',
          documentId: 'd1',
          confirm: true,
        },
        baseContext,
      );

      expect(mockDocumentRepository.delete).toHaveBeenCalledWith({ id: 'd1' });
      expect(result).toContain('removido');
    });
  });

  describe('manage_report_images', () => {
    it('deve listar apenas imagens com key=report_images', async () => {
      mockDocumentRepo.findMany.mockResolvedValue([
        { id: 'd1', name: 'Laudo.pdf', key: 'doctorRequest' },
        {
          id: 'd2',
          name: 'Imagem.jpg',
          key: 'report_images',
          createdAt: new Date('2025-01-01'),
        },
      ]);

      const result = await getTool('manage_report_images').execute(
        { surgeryRequestId: 'req-1', operation: 'list' },
        baseContext,
      );

      expect(result).toContain('Imagem.jpg');
      expect(result).not.toContain('Laudo.pdf');
    });

    it('deve recusar attach quando o arquivo não for imagem', async () => {
      const result = await getTool('manage_report_images').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'attach',
          confirm: true,
        },
        {
          ...baseContext,
          inboundMedia: [
            {
              url: 'https://api.twilio.com/2010-04-01/media/1',
              contentType: 'application/pdf',
            },
          ],
        },
      );

      expect(result).toContain('não é uma imagem');
    });

    it('deve anexar imagem ao laudo com key=report_images', async () => {
      const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
      } as any);

      mockStorageService.create.mockResolvedValue('documents/img-1.jpg');
      mockDocumentRepo.create.mockResolvedValue({ id: 'i-new' });

      const result = await getTool('manage_report_images').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'attach',
          imageName: 'RX joelho',
          confirm: true,
        },
        {
          ...baseContext,
          inboundMedia: [
            {
              url: 'https://api.twilio.com/2010-04-01/media/1',
              contentType: 'image/jpeg',
            },
          ],
        },
      );

      expect(mockDocumentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'report_images',
          type: 'exam_image',
        }),
      );
      expect(result).toContain('anexada');

      fetchMock.mockRestore();
    });

    it('deve recusar remover quando o documento não é uma imagem do laudo', async () => {
      mockDocumentRepo.findOne.mockResolvedValue({
        id: 'd1',
        name: 'Laudo.pdf',
        key: 'doctorRequest',
        surgeryRequestId: 'req-1',
      });

      const result = await getTool('manage_report_images').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'remove',
          imageId: 'd1',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('Imagem do laudo não encontrada');
      expect(mockDocumentRepository.delete).not.toHaveBeenCalled();
    });

    it('deve remover imagem do laudo quando confirm=true', async () => {
      mockDocumentRepo.findOne.mockResolvedValue({
        id: 'd2',
        name: 'Imagem.jpg',
        key: 'report_images',
        surgeryRequestId: 'req-1',
      });

      const result = await getTool('manage_report_images').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'remove',
          imageId: 'd2',
          confirm: true,
        },
        baseContext,
      );

      expect(mockDocumentRepository.delete).toHaveBeenCalledWith({ id: 'd2' });
      expect(result).toContain('removida');
    });

    it('deve recusar attach/remove quando SC não está em Pendente', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(sentRequest);

      const attachResult = await getTool('manage_report_images').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'attach',
          confirm: true,
        },
        {
          ...baseContext,
          inboundMedia: [{ url: 'https://x', contentType: 'image/jpeg' }],
        },
      );
      expect(attachResult).toContain('histórico');
      expect(mockDocumentRepo.create).not.toHaveBeenCalled();

      const removeResult = await getTool('manage_report_images').execute(
        {
          surgeryRequestId: 'req-1',
          operation: 'remove',
          imageId: 'd2',
          confirm: true,
        },
        baseContext,
      );
      expect(removeResult).toContain('histórico');
      expect(mockDocumentRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('set_health_plan', () => {
    it('deve remover convênio com clear=true e confirm=true', async () => {
      const result = await getTool('set_health_plan').execute(
        {
          surgeryRequestId: 'req-1',
          clear: true,
          confirm: true,
        },
        baseContext,
      );

      expect(mockSurgeryRequestRepo.update).toHaveBeenCalledWith('req-1', {
        healthPlanId: null,
      });
      expect(result).toContain('Convênio removido');
    });

    it('deve exigir healthPlanId ou health_plan_name', async () => {
      const result = await getTool('set_health_plan').execute(
        { surgeryRequestId: 'req-1' },
        baseContext,
      );

      expect(result).toContain('healthPlanId');
    });

    it('deve falhar quando o convênio não existe na clínica', async () => {
      mockHealthPlanRepo.findOne.mockResolvedValue(null);

      const result = await getTool('set_health_plan').execute(
        {
          surgeryRequestId: 'req-1',
          health_plan_name: 'Inexistente',
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('não encontrado');
      expect(mockSurgeryRequestRepo.update).not.toHaveBeenCalled();
    });

    it('deve atualizar convênio quando encontrado', async () => {
      mockHealthPlanRepo.findOne.mockResolvedValue({
        id: 'hp-1',
        name: 'Unimed',
      });

      const result = await getTool('set_health_plan').execute(
        {
          surgeryRequestId: 'req-1',
          healthPlanId: 'hp-1',
          confirm: true,
        },
        baseContext,
      );

      expect(mockSurgeryRequestRepo.update).toHaveBeenCalledWith('req-1', {
        healthPlanId: 'hp-1',
      });
      expect(result).toContain('Convênio atualizado');
    });

    it('deve recusar mutação fora de Pendente (mesmo com clear=true)', async () => {
      mockSurgeryRequestRepo.findOneSimple.mockResolvedValue(sentRequest);

      const result = await getTool('set_health_plan').execute(
        {
          surgeryRequestId: 'req-1',
          clear: true,
          confirm: true,
        },
        baseContext,
      );

      expect(result).toContain('histórico');
      expect(mockSurgeryRequestRepo.update).not.toHaveBeenCalled();
    });
  });
});
