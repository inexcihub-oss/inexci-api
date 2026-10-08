import { SurgeryRequestsService } from './surgery-requests.service';

/**
 * GET /surgery-requests/available-doctors alimenta a Agenda, o wizard de SC e
 * a tela de atendimento. Esta última decide os botões de receita/atestado/
 * pedido de exame por `canIssueClinicalDocuments` — sem o campo, o frontend
 * caía em `isPhysician` e desabilitava os documentos do dentista (CRO).
 */
describe('SurgeryRequestsService.getAvailableDoctors', () => {
  function makeService(doctors: unknown[]) {
    const accessControlService = {
      getAvailableDoctorsForCreation: jest.fn().mockResolvedValue(doctors),
    };
    const service = new SurgeryRequestsService(
      {} as never,
      accessControlService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return service;
  }

  const prof = (id: string, council: string | undefined) => ({
    id,
    name: `Prof ${id}`,
    doctorProfile: {
      council,
      crm: '123',
      crmState: 'RJ',
      specialty: 'X',
    },
  });

  it('devolve conselho, isPhysician e canIssueClinicalDocuments por profissional', async () => {
    const service = makeService([
      prof('crm', 'CRM'),
      prof('cro', 'CRO'),
      prof('crn', 'CRN'),
      prof('sem', undefined),
    ]);

    const result = await service.getAvailableDoctors('user-1');

    expect(result).toEqual([
      {
        id: 'crm',
        name: 'Prof crm',
        crm: '123',
        crmState: 'RJ',
        specialty: 'X',
        council: 'CRM',
        isPhysician: true,
        canIssueClinicalDocuments: true,
      },
      expect.objectContaining({
        id: 'cro',
        council: 'CRO',
        isPhysician: false,
        canIssueClinicalDocuments: true,
      }),
      expect.objectContaining({
        id: 'crn',
        isPhysician: false,
        canIssueClinicalDocuments: false,
      }),
      expect.objectContaining({
        id: 'sem',
        isPhysician: false,
        canIssueClinicalDocuments: false,
      }),
    ]);
  });
});
