import { BadRequestException, ConflictException } from '@nestjs/common';
import { SurgeryRequestBillingService } from './surgery-request-billing.service';
import { SurgeryRequestStatus } from 'src/database/entities/surgery-request.entity';
import { SURGERY_REQUEST_EVENTS } from '../events/surgery-request.events';

describe('SurgeryRequestBillingService', () => {
  let repository: {
    findOneForBilling: jest.Mock;
    applyStatusTransition: jest.Mock;
  };
  let manager: { getRepository: jest.Mock };
  let billingRepo: { save: jest.Mock; update: jest.Mock };
  let eventEmitter: { emit: jest.Mock };
  let contestationRepository: { create: jest.Mock };
  let mailService: { sendPaymentContested: jest.Mock };
  let service: SurgeryRequestBillingService;

  const performed = {
    id: 'sc-1',
    status: SurgeryRequestStatus.PERFORMED,
    healthPlanId: null,
    healthPlan: null,
  };

  beforeEach(() => {
    billingRepo = {
      save: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    };
    manager = { getRepository: jest.fn(() => billingRepo) };
    repository = {
      findOneForBilling: jest.fn().mockResolvedValue({ ...performed }),
      applyStatusTransition: jest.fn().mockResolvedValue(true),
    };
    eventEmitter = { emit: jest.fn() };
    contestationRepository = { create: jest.fn().mockResolvedValue({}) };
    mailService = { sendPaymentContested: jest.fn().mockResolvedValue({}) };
    service = new SurgeryRequestBillingService(
      { transaction: jest.fn(async (cb: any) => cb(manager)) } as never,
      mailService as never,
      repository as never,
      { update: jest.fn() } as never,
      contestationRepository as never,
      { assertCanAdvance: jest.fn().mockResolvedValue(undefined) } as never,
      eventEmitter as never,
    );
  });

  const invoice = () =>
    service.invoiceRequest(
      'sc-1',
      {
        invoiceProtocol: 'F-1',
        invoiceSentAt: '2026-01-10',
        invoiceValue: 100,
      } as never,
      'user-1',
    );

  it('fatura com UPDATE condicional (Realizada → Faturada) e emite o evento', async () => {
    await invoice();

    expect(repository.applyStatusTransition).toHaveBeenCalledWith(manager, {
      id: 'sc-1',
      from: SurgeryRequestStatus.PERFORMED,
      to: SurgeryRequestStatus.INVOICED,
      userId: 'user-1',
    });
    expect(billingRepo.save).toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      SURGERY_REQUEST_EVENTS.STATUS_CHANGED,
      expect.objectContaining({ to: SurgeryRequestStatus.INVOICED }),
    );
  });

  it('clique duplo no faturamento: 409 sem gravar segundo faturamento', async () => {
    repository.applyStatusTransition.mockResolvedValue(false);

    await expect(invoice()).rejects.toThrow(ConflictException);
    expect(billingRepo.save).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('faturar fora de Realizada passa pela máquina de estados', async () => {
    repository.findOneForBilling.mockResolvedValue({
      ...performed,
      status: SurgeryRequestStatus.SCHEDULED,
    });

    await expect(invoice()).rejects.toMatchObject({
      response: { pendencies: expect.any(Array) },
    });
    expect(repository.applyStatusTransition).not.toHaveBeenCalled();
  });

  it('confirmReceipt devolve a divergência e transiciona Faturada → Finalizada', async () => {
    repository.findOneForBilling.mockResolvedValue({
      id: 'sc-1',
      status: SurgeryRequestStatus.INVOICED,
      billing: { invoiceValue: '100.00' },
    });

    const result = await service.confirmReceipt(
      'sc-1',
      { receivedValue: 90, receivedAt: '2026-02-01' } as never,
      'user-1',
    );

    expect(result).toEqual({
      hasDivergence: true,
      invoiceValue: 100,
      receivedValue: 90,
    });
    expect(repository.applyStatusTransition).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        from: SurgeryRequestStatus.INVOICED,
        to: SurgeryRequestStatus.FINALIZED,
      }),
    );
  });

  it('contestPayment exige Finalizada (assertStatus)', async () => {
    await expect(
      service.contestPayment(
        'sc-1',
        { to: 'x@y.com', subject: 's', message: 'm' } as never,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(contestationRepository.create).not.toHaveBeenCalled();
  });
});
