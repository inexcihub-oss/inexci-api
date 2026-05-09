import { BadRequestException } from '@nestjs/common';
import { SurgeryRequestStateMachine } from './surgery-request-state-machine';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';

function makeRequest(overrides: Partial<SurgeryRequest> = {}): SurgeryRequest {
  return {
    id: 'test-id',
    status: SurgeryRequestStatus.PENDING,
    patientId: 'patient-1',
    hospitalId: 'hospital-1',
    tussItems: [{ id: '1', name: 'Proc', tussCode: '123', quantity: 1 }],
    billing: null,
    ...overrides,
  } as unknown as SurgeryRequest;
}

describe('SurgeryRequestStateMachine', () => {
  let sm: SurgeryRequestStateMachine;

  beforeEach(() => {
    sm = new SurgeryRequestStateMachine();
  });

  // ── PENDING → SENT ─────────────────────────────────────────────────────

  describe('PENDING → SENT', () => {
    it('should allow transition when all data is present', () => {
      const req = makeRequest();
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.SENT)).toBe(true);
    });

    it('should block when status is not PENDING', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS });
      const pendencies = sm.getBlockingPendencies(
        req,
        SurgeryRequestStatus.SENT,
      );
      expect(pendencies).toContain(
        'A solicitação precisa estar com status Pendente para ser enviada.',
      );
    });

    it('should block when patientId is missing', () => {
      const req = makeRequest({ patientId: null });
      const pendencies = sm.getBlockingPendencies(
        req,
        SurgeryRequestStatus.SENT,
      );
      expect(pendencies).toContain('Paciente não informado.');
    });

    it('should block when hospitalId is missing', () => {
      const req = makeRequest({ hospitalId: null });
      const pendencies = sm.getBlockingPendencies(
        req,
        SurgeryRequestStatus.SENT,
      );
      expect(pendencies).toContain('Hospital não informado.');
    });

    it('should block when tussItems is empty', () => {
      const req = makeRequest({ tussItems: [] as any });
      const pendencies = sm.getBlockingPendencies(
        req,
        SurgeryRequestStatus.SENT,
      );
      expect(pendencies).toContain('Nenhum procedimento TUSS informado.');
    });

    it('should return multiple pendencies at once', () => {
      const req = makeRequest({
        patientId: null,
        hospitalId: null,
        tussItems: [] as any,
      });
      const pendencies = sm.getBlockingPendencies(
        req,
        SurgeryRequestStatus.SENT,
      );
      expect(pendencies).toHaveLength(3);
    });
  });

  // ── SENT → IN_ANALYSIS ─────────────────────────────────────────────────

  describe('SENT → IN_ANALYSIS', () => {
    it('should allow transition from SENT', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.SENT });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.IN_ANALYSIS)).toBe(
        true,
      );
    });

    it('should block from wrong status', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.PENDING });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.IN_ANALYSIS)).toBe(
        false,
      );
    });
  });

  // ── IN_ANALYSIS → IN_SCHEDULING ────────────────────────────────────────

  describe('IN_ANALYSIS → IN_SCHEDULING', () => {
    it('should allow transition from IN_ANALYSIS', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.IN_SCHEDULING)).toBe(
        true,
      );
    });

    it('should block from wrong status', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.SENT });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.IN_SCHEDULING)).toBe(
        false,
      );
    });
  });

  // ── IN_SCHEDULING → SCHEDULED ──────────────────────────────────────────

  describe('IN_SCHEDULING → SCHEDULED', () => {
    it('should allow transition from IN_SCHEDULING', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.IN_SCHEDULING });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.SCHEDULED)).toBe(
        true,
      );
    });
  });

  // ── SCHEDULED → PERFORMED ──────────────────────────────────────────────

  describe('SCHEDULED → PERFORMED', () => {
    it('should allow transition from SCHEDULED', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.SCHEDULED });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.PERFORMED)).toBe(
        true,
      );
    });
  });

  // ── PERFORMED → INVOICED ───────────────────────────────────────────────

  describe('PERFORMED → INVOICED', () => {
    it('should allow transition with billing data', () => {
      const req = makeRequest({
        status: SurgeryRequestStatus.PERFORMED,
        billing: {
          invoiceValue: 1000,
          invoiceSentAt: new Date(),
        } as any,
      });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.INVOICED)).toBe(true);
    });

    it('should block without invoiceValue', () => {
      const req = makeRequest({
        status: SurgeryRequestStatus.PERFORMED,
        billing: { invoiceSentAt: new Date() } as any,
      });
      const pendencies = sm.getBlockingPendencies(
        req,
        SurgeryRequestStatus.INVOICED,
      );
      expect(pendencies).toContain('Valor da fatura não informado.');
    });

    it('should block without invoiceSentAt', () => {
      const req = makeRequest({
        status: SurgeryRequestStatus.PERFORMED,
        billing: { invoiceValue: 1000 } as any,
      });
      const pendencies = sm.getBlockingPendencies(
        req,
        SurgeryRequestStatus.INVOICED,
      );
      expect(pendencies).toContain('Data de envio da fatura não informada.');
    });

    it('should block from wrong status', () => {
      const req = makeRequest({
        status: SurgeryRequestStatus.SCHEDULED,
        billing: { invoiceValue: 1000, invoiceSentAt: new Date() } as any,
      });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.INVOICED)).toBe(
        false,
      );
    });
  });

  // ── INVOICED → FINALIZED ───────────────────────────────────────────────

  describe('INVOICED → FINALIZED', () => {
    it('should allow transition with received data', () => {
      const req = makeRequest({
        status: SurgeryRequestStatus.INVOICED,
        billing: {
          receivedValue: 900,
          receivedAt: new Date(),
        } as any,
      });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.FINALIZED)).toBe(
        true,
      );
    });

    it('should block without receivedValue', () => {
      const req = makeRequest({
        status: SurgeryRequestStatus.INVOICED,
        billing: { receivedAt: new Date() } as any,
      });
      const pendencies = sm.getBlockingPendencies(
        req,
        SurgeryRequestStatus.FINALIZED,
      );
      expect(pendencies).toContain('Valor recebido não informado.');
    });

    it('should block without receivedAt', () => {
      const req = makeRequest({
        status: SurgeryRequestStatus.INVOICED,
        billing: { receivedValue: 900 } as any,
      });
      const pendencies = sm.getBlockingPendencies(
        req,
        SurgeryRequestStatus.FINALIZED,
      );
      expect(pendencies).toContain('Data de recebimento não informada.');
    });
  });

  // ── QUALQUER → CLOSED ─────────────────────────────────────────────────

  describe('→ CLOSED', () => {
    it('should allow closing from PENDING', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.PENDING });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.CLOSED)).toBe(true);
    });

    it('should allow closing from IN_ANALYSIS', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.CLOSED)).toBe(true);
    });

    it('should allow closing from INVOICED', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.INVOICED });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.CLOSED)).toBe(true);
    });

    it('should block closing from FINALIZED', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.FINALIZED });
      const pendencies = sm.getBlockingPendencies(
        req,
        SurgeryRequestStatus.CLOSED,
      );
      expect(pendencies[0]).toContain('Finalizada');
    });

    it('should block closing from CLOSED', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.CLOSED });
      const pendencies = sm.getBlockingPendencies(
        req,
        SurgeryRequestStatus.CLOSED,
      );
      expect(pendencies[0]).toContain('Encerrada');
    });
  });

  // ── assertCanTransition ────────────────────────────────────────────────

  describe('assertCanTransition', () => {
    it('should not throw for valid transition', () => {
      const req = makeRequest();
      expect(() =>
        sm.assertCanTransition(req, SurgeryRequestStatus.SENT),
      ).not.toThrow();
    });

    it('should throw BadRequestException with pendencies for invalid transition', () => {
      const req = makeRequest({ patientId: null });
      try {
        sm.assertCanTransition(req, SurgeryRequestStatus.SENT);
        fail('Expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = (err as BadRequestException).getResponse() as any;
        expect(response.pendencies).toContain('Paciente não informado.');
      }
    });
  });

  // ── Unknown target status ──────────────────────────────────────────────

  describe('unknown target status', () => {
    it('should return pendency for unrecognized status', () => {
      const req = makeRequest();
      const pendencies = sm.getBlockingPendencies(req, 999 as any);
      expect(pendencies[0]).toContain('não reconhecida');
    });
  });
});
