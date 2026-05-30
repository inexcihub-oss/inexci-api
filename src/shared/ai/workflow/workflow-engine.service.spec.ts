import { WorkflowEngineService } from './workflow-engine.service';

describe('WorkflowEngineService', () => {
  function buildEngine(overrides: Partial<Record<string, jest.Mock>> = {}) {
    const sendRequest = overrides.sendRequest ?? jest.fn().mockResolvedValue({ status: 2 });
    const startAnalysis = overrides.startAnalysis ?? jest.fn().mockResolvedValue({ status: 3 });
    const acceptAuthorization = overrides.acceptAuthorization ?? jest.fn().mockResolvedValue({ status: 4 });
    const contestAuthorization = overrides.contestAuthorization ?? jest.fn().mockResolvedValue({ status: 99 });
    const confirmDate = overrides.confirmDate ?? jest.fn().mockResolvedValue({ status: 5 });
    const updateDateOptions = overrides.updateDateOptions ?? jest.fn().mockResolvedValue({ status: 5 });
    const reschedule = overrides.reschedule ?? jest.fn().mockResolvedValue({ status: 5 });
    const markPerformed = overrides.markPerformed ?? jest.fn().mockResolvedValue({ status: 6 });
    const invoiceRequest = overrides.invoiceRequest ?? jest.fn().mockResolvedValue({ status: 7 });
    const confirmReceipt = overrides.confirmReceipt ?? jest.fn().mockResolvedValue({ status: 8 });
    const contestPayment = overrides.contestPayment ?? jest.fn().mockResolvedValue({ status: 99 });
    const updateReceipt = overrides.updateReceipt ?? jest.fn().mockResolvedValue({ status: 8 });
    const closeSurgeryRequest = overrides.closeSurgeryRequest ?? jest.fn().mockResolvedValue({ status: 9 });

    const workflowService: any = {
      sendRequest,
      startAnalysis,
      acceptAuthorization,
      contestAuthorization,
      confirmDate,
      updateDateOptions,
      reschedule,
      markPerformed,
      invoiceRequest,
      confirmReceipt,
      contestPayment,
      updateReceipt,
      closeSurgeryRequest,
    };
    const engine = new WorkflowEngineService(workflowService);
    return { engine, workflowService, mocks: { sendRequest, startAnalysis, acceptAuthorization, contestAuthorization, confirmDate, updateDateOptions, reschedule, markPerformed, invoiceRequest, confirmReceipt, contestPayment, updateReceipt, closeSurgeryRequest } };
  }

  it('roteia send_sc para sendRequest e emite evento sc.sent', async () => {
    const { engine, mocks } = buildEngine();
    const result = await engine.execute({
      type: 'send_sc',
      surgeryRequestId: 'sc-1',
      payload: { sentAt: '2026-05-14' },
      actor: { userId: 'u1', origin: 'whatsapp' },
    });
    expect(mocks.sendRequest).toHaveBeenCalledWith('sc-1', { sentAt: '2026-05-14' }, 'u1');
    expect(result.status).toBe('ok');
    expect(result.events[0].name).toBe('sc.sent');
    expect(result.events[0].surgeryRequestId).toBe('sc-1');
    expect(result.newStatus).toBe(2);
  });

  it('roteia mark_performed e propaga newStatus', async () => {
    const { engine, mocks } = buildEngine();
    const result = await engine.execute({
      type: 'mark_performed',
      surgeryRequestId: 'sc-2',
      payload: { performedAt: '2026-05-13' },
      actor: { userId: 'u1', origin: 'dashboard' },
    });
    expect(mocks.markPerformed).toHaveBeenCalled();
    expect(result.events[0].name).toBe('sc.performed');
    expect(result.newStatus).toBe(6);
  });

  it('captura erro e devolve status=error com summary legível', async () => {
    const { engine } = buildEngine({
      sendRequest: jest.fn().mockRejectedValue(new Error('SC já enviada')),
    });
    const result = await engine.execute({
      type: 'send_sc',
      surgeryRequestId: 'sc-3',
      payload: {},
      actor: { userId: 'u1', origin: 'whatsapp' },
    });
    expect(result.status).toBe('error');
    expect(result.summary).toBe('SC já enviada');
    expect(result.events).toEqual([]);
  });

  it('todos os types disparam o handler correto', async () => {
    const { engine, mocks } = buildEngine();
    const types = [
      ['send_sc', mocks.sendRequest],
      ['start_analysis', mocks.startAnalysis],
      ['accept_authorization', mocks.acceptAuthorization],
      ['contest_authorization', mocks.contestAuthorization],
      ['confirm_date', mocks.confirmDate],
      ['update_date_options', mocks.updateDateOptions],
      ['reschedule', mocks.reschedule],
      ['mark_performed', mocks.markPerformed],
      ['invoice_request', mocks.invoiceRequest],
      ['confirm_receipt', mocks.confirmReceipt],
      ['contest_payment', mocks.contestPayment],
      ['update_receipt', mocks.updateReceipt],
      ['close_surgery_request', mocks.closeSurgeryRequest],
    ] as const;
    for (const [type, mock] of types) {
      await engine.execute({
        type: type as any,
        surgeryRequestId: 'sc',
        payload: {},
        actor: { userId: 'u', origin: 'system' },
      });
      expect(mock).toHaveBeenCalled();
    }
  });
});
