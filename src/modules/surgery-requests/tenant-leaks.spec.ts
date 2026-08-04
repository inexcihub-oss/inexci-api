describe('Vazamentos de tenant em cadastros vinculados', () => {
  it('authorize so atualiza itens que pertencem a SC informada', async () => {
    const tussRepo = { update: jest.fn(), findOne: jest.fn() };
    const opmeRepo = { update: jest.fn(), findOne: jest.fn() };

    // Item de outra SC: nao pode ser atualizado. O mock simula o filtro
    // composto (id + surgeryRequestId) que o repositorio real aplicaria —
    // so retorna o item quando a query pede exatamente a SC dona dele.
    tussRepo.findOne.mockImplementation(
      async (where: { id: string; surgeryRequestId: string }) =>
        where.id === 'item-x' &&
        where.surgeryRequestId === 'sc-de-outra-clinica'
          ? { id: 'item-x', surgeryRequestId: 'sc-de-outra-clinica' }
          : null,
    );

    const { ProceduresService } =
      await import('./procedures/procedures.service');
    const service = Object.create(ProceduresService.prototype);
    Object.assign(service, {
      accessValidator: {
        validateAndFetch: jest.fn().mockResolvedValue({ id: 'sc-propria' }),
      },
      tussItemRepository: tussRepo,
      opmeItemRepository: opmeRepo,
    });

    await expect(
      service.authorize(
        {
          surgeryRequestId: 'sc-propria',
          surgeryRequestProcedures: [{ id: 'item-x', authorizedQuantity: 0 }],
          opmeItems: [],
        } as any,
        'atacante',
      ),
    ).rejects.toThrow();

    expect(tussRepo.update).not.toHaveBeenCalled();
  });

  it('resolveSuppliers filtra por ownerId', async () => {
    const supplierRepository = { findOne: jest.fn().mockResolvedValue(null) };
    const { OpmeService } = await import('./opme/opme.service');
    const service = Object.create(OpmeService.prototype);
    Object.assign(service, { supplierRepository });

    await (service as any).resolveSuppliers(
      ['forn-de-outra-clinica'],
      [],
      'owner-a',
    );

    expect(supplierRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'owner-a' }),
    );
  });
});
