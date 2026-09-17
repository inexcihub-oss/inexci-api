import { ForbiddenException } from '@nestjs/common';
import { ProceduresService } from './procedures.service';

/**
 * O fornecedor vencedor é gravado aqui, quando o convênio responde. É o campo
 * que alimenta o PDF da solicitação, a coluna Fornecedor da agenda, a tela do
 * fornecedor e o filtro do kanban — por isso ele aceita duas respostas, e
 * nenhuma outra: um dos fornecedores da conta, ou o genérico "Outro", que
 * significa "o convênio aprovou alguém fora dos cotados".
 */
describe('ProceduresService.authorize — fornecedor vencedor', () => {
  const SC = { id: 'sr-1', ownerId: 'owner-1' };

  function montar(fornecedoresDaConta: Array<{ id: string }> = []) {
    const opmeRepo = { findOne: jest.fn(), update: jest.fn() };
    const tussRepo = { findOne: jest.fn(), update: jest.fn() };
    opmeRepo.findOne.mockResolvedValue({ id: 'opme-1' });

    const manager = {
      getRepository: jest.fn((entidade: { name: string }) =>
        entidade.name === 'OpmeItem' ? opmeRepo : tussRepo,
      ),
    };
    const dataSource = {
      transaction: jest.fn((fn: (m: unknown) => Promise<unknown>) =>
        fn(manager),
      ),
    };
    const accessValidator = {
      validateAndFetch: jest.fn().mockResolvedValue(SC),
    };
    const supplierRepository = {
      ensureGeneric: jest
        .fn()
        .mockResolvedValue({ id: 'generic-1', isGeneric: true }),
      findMany: jest.fn().mockResolvedValue(fornecedoresDaConta),
    };

    const service = new ProceduresService(
      dataSource as never,
      {} as never,
      {} as never,
      accessValidator as never,
      supplierRepository as never,
    );

    return { service, opmeRepo, supplierRepository };
  }

  const autorizar = (opme: Record<string, unknown>) => ({
    surgeryRequestId: 'sr-1',
    surgeryRequestProcedures: [],
    opmeItems: [{ id: 'opme-1', authorizedQuantity: 1, ...opme }],
  });

  it('grava o genérico da conta quando o vencedor é "Outro"', async () => {
    const { service, opmeRepo, supplierRepository } = montar();

    await service.authorize(
      autorizar({ selectedSupplierIsGeneric: true }) as never,
      'user-1',
    );

    expect(supplierRepository.ensureGeneric).toHaveBeenCalledWith('owner-1');
    expect(opmeRepo.update).toHaveBeenCalledWith(
      'opme-1',
      expect.objectContaining({ selectedSupplierId: 'generic-1' }),
    );
  });

  it('grava o fornecedor escolhido quando ele é da conta', async () => {
    const { service, opmeRepo } = montar([{ id: 'sup-1' }]);

    await service.authorize(
      autorizar({ selectedSupplierId: 'sup-1' }) as never,
      'user-1',
    );

    expect(opmeRepo.update).toHaveBeenCalledWith(
      'opme-1',
      expect.objectContaining({ selectedSupplierId: 'sup-1' }),
    );
  });

  /**
   * O id vem do cliente e só era validado como UUID. Apontar o item para o
   * fornecedor de outra clínica fazia o nome dela sair no PDF da solicitação.
   */
  it('recusa fornecedor que não pertence à conta', async () => {
    const { service, opmeRepo } = montar([]);

    await expect(
      service.authorize(
        autorizar({ selectedSupplierId: 'sup-de-outra-conta' }) as never,
        'user-1',
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(opmeRepo.update).not.toHaveBeenCalled();
  });

  it('não cria a linha genérica quando ninguém escolheu "Outro"', async () => {
    const { service, supplierRepository } = montar([{ id: 'sup-1' }]);

    await service.authorize(
      autorizar({ selectedSupplierId: 'sup-1' }) as never,
      'user-1',
    );

    expect(supplierRepository.ensureGeneric).not.toHaveBeenCalled();
  });
});
