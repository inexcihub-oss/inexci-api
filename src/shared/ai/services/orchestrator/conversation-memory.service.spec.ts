import { Logger } from '@nestjs/common';
import { ConversationMemoryService } from './conversation-memory.service';
import { WhatsappConversationRepository } from '../../../../database/repositories/whatsapp-conversation.repository';
import { UserRepository } from '../../../../database/repositories/user.repository';

const makeConvRepo = (
  overrides: Partial<
    Record<keyof WhatsappConversationRepository, jest.Mock>
  > = {},
) =>
  ({
    findOne: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as WhatsappConversationRepository;

const makeUserRepo = (
  overrides: Partial<Record<keyof UserRepository, jest.Mock>> = {},
) =>
  ({
    findMany: jest.fn().mockResolvedValue([]),
    ...overrides,
  }) as unknown as UserRepository;

describe('ConversationMemoryService', () => {
  let service: ConversationMemoryService;
  let convRepo: ReturnType<typeof makeConvRepo>;
  let userRepo: ReturnType<typeof makeUserRepo>;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    convRepo = makeConvRepo();
    userRepo = makeUserRepo();
    service = new ConversationMemoryService(
      convRepo as unknown as WhatsappConversationRepository,
      userRepo as unknown as UserRepository,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('memorizeEntities', () => {
    it('não grava quando toolResult.status !== ok', async () => {
      await service.memorizeEntities({
        conversationId: 'conv-1',
        toolName: 'set_hospital',
        args: { hospitalId: 'h-1' },
        output: JSON.stringify({ status: 'error', message: 'falha' }),
      });
      expect(convRepo.update).not.toHaveBeenCalled();
    });

    it('grava hospital em surgeryRequest quando status === ok', async () => {
      convRepo.findOne = jest.fn().mockResolvedValue({
        conversationMemory: {},
      });
      await service.memorizeEntities({
        conversationId: 'conv-1',
        toolName: 'set_hospital',
        args: { hospitalId: 'hosp-abc' },
        output: JSON.stringify({ status: 'ok' }),
      });
      expect(convRepo.update).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          conversationMemory: expect.objectContaining({
            surgeryRequest: expect.objectContaining({ hospital: 'hosp-abc' }),
          }),
        }),
      );
    });

    it('grava healthPlan em surgeryRequest quando status === ok', async () => {
      convRepo.findOne = jest.fn().mockResolvedValue({
        conversationMemory: {},
      });
      await service.memorizeEntities({
        conversationId: 'conv-1',
        toolName: 'set_health_plan',
        args: { health_plan_name: 'Unimed' },
        output: JSON.stringify({ status: 'ok' }),
      });
      expect(convRepo.update).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          conversationMemory: expect.objectContaining({
            surgeryRequest: expect.objectContaining({ healthPlan: 'Unimed' }),
          }),
        }),
      );
    });

    it('não grava para toolName não mapeado', async () => {
      await service.memorizeEntities({
        conversationId: 'conv-1',
        toolName: 'list_surgery_requests',
        args: {},
        output: JSON.stringify({ status: 'ok' }),
      });
      expect(convRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('patchMemory', () => {
    it('mergeia sem sobrescrever campos existentes', async () => {
      convRepo.findOne = jest.fn().mockResolvedValue({
        conversationMemory: { existingKey: 'existingValue' },
      });
      await service.patchMemory('conv-1', { newKey: 'newValue' });
      expect(convRepo.update).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          conversationMemory: expect.objectContaining({
            existingKey: 'existingValue',
            newKey: 'newValue',
          }),
        }),
      );
    });
  });

  describe('resolveDoctorsInfo', () => {
    it('retorna do cache sem bater no banco na segunda chamada', async () => {
      userRepo.findMany = jest
        .fn()
        .mockResolvedValue([{ id: 'd-1', name: 'Dr. A' }]);
      const ids = ['d-1'];
      await service.resolveDoctorsInfo(ids);
      await service.resolveDoctorsInfo(ids);
      expect(userRepo.findMany).toHaveBeenCalledTimes(1);
    });

    it('retorna fallback com name=null em caso de erro no banco', async () => {
      userRepo.findMany = jest.fn().mockRejectedValue(new Error('db error'));
      const result = await service.resolveDoctorsInfo(['d-1', 'd-2']);
      expect(result).toEqual([
        { id: 'd-1', name: null },
        { id: 'd-2', name: null },
      ]);
    });
  });

  describe('readMemory', () => {
    it('retorna null em caso de falha silenciosa', async () => {
      convRepo.findOne = jest.fn().mockRejectedValue(new Error('db error'));
      const result = await service.readMemory('conv-1');
      expect(result).toBeNull();
    });

    it('retorna os dados da memória quando conversa existe', async () => {
      const memory = { filled_slots: { patient: 'João' } };
      convRepo.findOne = jest
        .fn()
        .mockResolvedValue({ conversationMemory: memory });
      const result = await service.readMemory('conv-1');
      expect(result).toEqual(memory);
    });
  });
});
