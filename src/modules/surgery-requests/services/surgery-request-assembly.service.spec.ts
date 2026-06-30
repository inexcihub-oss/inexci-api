import { SurgeryRequestAssemblyService } from './surgery-request-assembly.service';

describe('SurgeryRequestAssemblyService', () => {
  let surgeryRequestsService: any;
  let opmeService: any;
  let tussService: any;
  let service: SurgeryRequestAssemblyService;

  beforeEach(() => {
    surgeryRequestsService = {
      createReportSection: jest.fn().mockResolvedValue({}),
      addTussItem: jest.fn().mockResolvedValue({}),
      setHasOpme: jest.fn().mockResolvedValue({}),
    };
    opmeService = {
      create: jest.fn().mockResolvedValue({ id: 'opme-1' }),
    };
    tussService = {
      lookup: jest.fn().mockReturnValue([{ code: '3.07.15.091', name: 'Descompressão' }]),
    };

    service = new SurgeryRequestAssemblyService(
      surgeryRequestsService,
      opmeService,
      tussService,
    );
  });

  it('cria laudo quando notes é fornecido', async () => {
    const result = await service.assembleFromExtracted({
      scId: 'sc-1',
      notes: 'Paciente com hérnia discal L4-L5.',
      userId: 'user-1',
    });

    expect(surgeryRequestsService.createReportSection).toHaveBeenCalledWith(
      'sc-1',
      { title: 'Laudo', description: 'Paciente com hérnia discal L4-L5.' },
      'user-1',
    );
    expect(result.warnings).toHaveLength(0);
  });

  it('não chama createReportSection quando notes é undefined', async () => {
    await service.assembleFromExtracted({ scId: 'sc-1', userId: 'user-1' });
    expect(surgeryRequestsService.createReportSection).not.toHaveBeenCalled();
  });

  it('adiciona TUSS usando descrição fornecida', async () => {
    await service.assembleFromExtracted({
      scId: 'sc-2',
      tussItems: [{ code: '3.07.15.091', description: 'Descompressão cervical' }],
      userId: 'user-2',
    });

    expect(surgeryRequestsService.addTussItem).toHaveBeenCalledWith(
      'sc-2',
      expect.objectContaining({ tussCode: '3.07.15.091', name: 'Descompressão cervical' }),
      'user-2',
    );
    expect(tussService.lookup).not.toHaveBeenCalled();
  });

  it('usa quantity informado no item TUSS em vez do default 1', async () => {
    await service.assembleFromExtracted({
      scId: 'sc-2b',
      tussItems: [
        { code: '3.07.15.091', description: 'Descompressão cervical', quantity: 3 },
      ],
      userId: 'user-2b',
    });

    expect(surgeryRequestsService.addTussItem).toHaveBeenCalledWith(
      'sc-2b',
      expect.objectContaining({ quantity: 3 }),
      'user-2b',
    );
  });

  it('usa quantity=1 quando o item TUSS não informa quantity', async () => {
    await service.assembleFromExtracted({
      scId: 'sc-2c',
      tussItems: [{ code: '3.07.15.091', description: 'Descompressão cervical' }],
      userId: 'user-2c',
    });

    expect(surgeryRequestsService.addTussItem).toHaveBeenCalledWith(
      'sc-2c',
      expect.objectContaining({ quantity: 1 }),
      'user-2c',
    );
  });

  it('resolve descrição TUSS via lookup quando description está ausente', async () => {
    await service.assembleFromExtracted({
      scId: 'sc-3',
      tussItems: [{ code: '3.07.15.091' }],
      userId: 'user-3',
    });

    expect(tussService.lookup).toHaveBeenCalledWith('3.07.15.091', 1);
    expect(surgeryRequestsService.addTussItem).toHaveBeenCalledWith(
      'sc-3',
      expect.objectContaining({ name: 'Descompressão' }),
      'user-3',
    );
  });

  it('acumula warning quando TUSS não tem descrição e lookup não resolve', async () => {
    tussService.lookup.mockReturnValueOnce([]);

    const result = await service.assembleFromExtracted({
      scId: 'sc-4',
      tussItems: [{ code: '9.99.99.999' }],
      userId: 'user-4',
    });

    expect(surgeryRequestsService.addTussItem).not.toHaveBeenCalled();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('9.99.99.999');
  });

  it('adiciona OPME com 3 fornecedores quando só 1 é informado', async () => {
    await service.assembleFromExtracted({
      scId: 'sc-5',
      opmeItems: [{ description: 'Parafuso pedicular', supplier: 'Synthes', manufacturer: 'Synthes' }],
      userId: 'user-5',
    });

    expect(opmeService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Parafuso pedicular',
        supplierNames: expect.arrayContaining(['Synthes', 'Outros']),
        manufacturerNames: expect.arrayContaining(['Synthes', 'Outros']),
      }),
      'user-5',
    );
    const call = opmeService.create.mock.calls[0][0];
    expect(call.supplierNames).toHaveLength(3);
    expect(call.manufacturerNames).toHaveLength(3);
  });

  it('usa "Outros" quando supplier e manufacturer não são fornecidos', async () => {
    await service.assembleFromExtracted({
      scId: 'sc-6',
      opmeItems: [{ description: 'Cage cervical' }],
      userId: 'user-6',
    });

    const call = opmeService.create.mock.calls[0][0];
    expect(call.supplierNames).toEqual(['Outros', 'Outros', 'Outros']);
    expect(call.manufacturerNames).toEqual(['Outros', 'Outros', 'Outros']);
  });

  it('mescla suppliers do item + suggestedSuppliers do documento, sem duplicar', async () => {
    await service.assembleFromExtracted({
      scId: 'sc-11',
      suggestedSuppliers: ['Sintex', 'BW Medic', 'Las Brasil'],
      opmeItems: [{ description: 'Cânula', supplier: 'Sintex' }],
      userId: 'user-11',
    });

    const call = opmeService.create.mock.calls[0][0];
    expect(call.supplierNames).toEqual(['Sintex', 'BW Medic', 'Las Brasil']);
  });

  it('usa o array suppliers/manufacturers do item quando fornecido', async () => {
    await service.assembleFromExtracted({
      scId: 'sc-12',
      opmeItems: [
        {
          description: 'Placa',
          suppliers: ['Sintex', 'BW Medic', 'Las Brasil'],
          manufacturers: ['Marca A', 'Marca B'],
        },
      ],
      userId: 'user-12',
    });

    const call = opmeService.create.mock.calls[0][0];
    expect(call.supplierNames).toEqual(['Sintex', 'BW Medic', 'Las Brasil']);
    expect(call.manufacturerNames).toEqual(['Marca A', 'Marca B', 'Outros']);
  });

  it('cria uma ReportSection por item de sections, ignorando notes quando ambos vêm', async () => {
    const result = await service.assembleFromExtracted({
      scId: 'sc-13',
      notes: 'Não deveria ser usado',
      sections: [
        { title: 'Histórico e Diagnóstico', description: 'Texto clínico.' },
        { title: 'Conduta', description: 'Justificativa + custo.' },
      ],
      userId: 'user-13',
    });

    expect(surgeryRequestsService.createReportSection).toHaveBeenCalledTimes(2);
    expect(surgeryRequestsService.createReportSection).toHaveBeenNthCalledWith(
      1,
      'sc-13',
      { title: 'Histórico e Diagnóstico', description: 'Texto clínico.' },
      'user-13',
    );
    expect(surgeryRequestsService.createReportSection).toHaveBeenNthCalledWith(
      2,
      'sc-13',
      { title: 'Conduta', description: 'Justificativa + custo.' },
      'user-13',
    );
    expect(result.warnings).toHaveLength(0);
  });

  it('chama setHasOpme quando ao menos 1 OPME é adicionada', async () => {
    await service.assembleFromExtracted({
      scId: 'sc-7',
      opmeItems: [{ description: 'Placa cervical' }],
      userId: 'user-7',
    });

    expect(surgeryRequestsService.setHasOpme).toHaveBeenCalledWith('sc-7', true, 'user-7');
  });

  it('não chama setHasOpme quando lista de OPME é vazia', async () => {
    await service.assembleFromExtracted({
      scId: 'sc-8',
      opmeItems: [],
      userId: 'user-8',
    });

    expect(surgeryRequestsService.setHasOpme).not.toHaveBeenCalled();
  });

  it('acumula warning quando opmeService está ausente (undefined)', async () => {
    const serviceWithoutOpme = new SurgeryRequestAssemblyService(
      surgeryRequestsService,
      undefined,
      tussService,
    );

    const result = await serviceWithoutOpme.assembleFromExtracted({
      scId: 'sc-9',
      opmeItems: [{ description: 'Implante' }],
      userId: 'user-9',
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('serviço indisponível');
  });

  it('best-effort: acumula warnings mas completa parcialmente quando laudo falha', async () => {
    surgeryRequestsService.createReportSection.mockRejectedValueOnce(
      new Error('db timeout'),
    );
    surgeryRequestsService.addTussItem.mockResolvedValue({});

    const result = await service.assembleFromExtracted({
      scId: 'sc-10',
      notes: 'Laudo.',
      tussItems: [{ code: '3.07.15.091', description: 'Descompressão' }],
      userId: 'user-10',
    });

    expect(surgeryRequestsService.addTussItem).toHaveBeenCalled();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('laudo');
  });
});
