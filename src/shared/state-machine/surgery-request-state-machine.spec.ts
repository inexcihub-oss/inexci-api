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
    it('deve permitir transição quando status é PENDING', () => {
      const req = makeRequest();
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.SENT)).toBe(true);
    });

    it('deve bloquear quando status não é PENDING', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS });
      const pendencies = sm.getBlockingPendencies(req, SurgeryRequestStatus.SENT);
      expect(pendencies).toContain(
        'A solicitação precisa estar com status Pendente para ser enviada.',
      );
    });
  });

  // ── SENT → IN_ANALYSIS ─────────────────────────────────────────────────

  describe('SENT → IN_ANALYSIS', () => {
    it('deve permitir transição de SENT', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.SENT });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.IN_ANALYSIS)).toBe(true);
    });

    it('deve bloquear de status diferente de SENT', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.PENDING });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.IN_ANALYSIS)).toBe(false);
    });
  });

  // ── IN_ANALYSIS → IN_SCHEDULING ────────────────────────────────────────

  describe('IN_ANALYSIS → IN_SCHEDULING', () => {
    it('deve permitir transição de IN_ANALYSIS', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.IN_SCHEDULING)).toBe(true);
    });

    it('deve bloquear de status diferente de IN_ANALYSIS', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.SENT });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.IN_SCHEDULING)).toBe(false);
    });
  });

  // ── IN_SCHEDULING → SCHEDULED ──────────────────────────────────────────

  describe('IN_SCHEDULING → SCHEDULED', () => {
    it('deve permitir transição de IN_SCHEDULING', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.IN_SCHEDULING });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.SCHEDULED)).toBe(true);
    });

    it('deve bloquear de status diferente de IN_SCHEDULING', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.SCHEDULED)).toBe(false);
    });
  });

  // ── SCHEDULED → PERFORMED ──────────────────────────────────────────────

  describe('SCHEDULED → PERFORMED', () => {
    it('deve permitir transição de SCHEDULED', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.SCHEDULED });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.PERFORMED)).toBe(true);
    });

    it('deve bloquear de status diferente de SCHEDULED', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.IN_SCHEDULING });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.PERFORMED)).toBe(false);
    });
  });

  // ── PERFORMED → INVOICED ───────────────────────────────────────────────

  describe('PERFORMED → INVOICED', () => {
    it('deve permitir transição de PERFORMED (dados do DTO, não pré-checados)', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.PERFORMED });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.INVOICED)).toBe(true);
    });

    it('deve bloquear de status diferente de PERFORMED', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.SCHEDULED });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.INVOICED)).toBe(false);
    });
  });

  // ── INVOICED → FINALIZED ───────────────────────────────────────────────

  describe('INVOICED → FINALIZED', () => {
    it('deve permitir transição de INVOICED (dados do DTO, não pré-checados)', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.INVOICED });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.FINALIZED)).toBe(true);
    });

    it('deve bloquear de status diferente de INVOICED', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.PERFORMED });
      expect(sm.canTransitionTo(req, SurgeryRequestStatus.FINALIZED)).toBe(false);
    });
  });

  // ── QUALQUER → CLOSED ─────────────────────────────────────────────────

  describe('→ CLOSED', () => {
    it('deve permitir encerrar de PENDING', () => {
      expect(sm.canTransitionTo(makeRequest({ status: SurgeryRequestStatus.PENDING }), SurgeryRequestStatus.CLOSED)).toBe(true);
    });

    it('deve permitir encerrar de IN_ANALYSIS', () => {
      expect(sm.canTransitionTo(makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS }), SurgeryRequestStatus.CLOSED)).toBe(true);
    });

    it('deve permitir encerrar de INVOICED', () => {
      expect(sm.canTransitionTo(makeRequest({ status: SurgeryRequestStatus.INVOICED }), SurgeryRequestStatus.CLOSED)).toBe(true);
    });

    it('deve bloquear encerrar de FINALIZED', () => {
      const pendencies = sm.getBlockingPendencies(
        makeRequest({ status: SurgeryRequestStatus.FINALIZED }),
        SurgeryRequestStatus.CLOSED,
      );
      expect(pendencies[0]).toContain('Finalizada');
    });

    it('deve bloquear encerrar de CLOSED', () => {
      const pendencies = sm.getBlockingPendencies(
        makeRequest({ status: SurgeryRequestStatus.CLOSED }),
        SurgeryRequestStatus.CLOSED,
      );
      expect(pendencies[0]).toContain('Encerrada');
    });
  });

  // ── assertCanTransition ────────────────────────────────────────────────

  describe('assertCanTransition', () => {
    it('não deve lançar para transição estruturalmente válida', () => {
      const req = makeRequest();
      expect(() => sm.assertCanTransition(req, SurgeryRequestStatus.SENT)).not.toThrow();
    });

    it('deve lançar BadRequestException quando status atual é errado', () => {
      const req = makeRequest({ status: SurgeryRequestStatus.IN_ANALYSIS });
      try {
        sm.assertCanTransition(req, SurgeryRequestStatus.SENT);
        fail('Deveria ter lançado BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = (err as BadRequestException).getResponse() as any;
        expect(response.pendencies[0]).toContain('Pendente');
      }
    });
  });

  // ── Status desconhecido ────────────────────────────────────────────────

  describe('status desconhecido', () => {
    it('deve retornar pendência para status não reconhecido', () => {
      const req = makeRequest();
      const pendencies = sm.getBlockingPendencies(req, 999 as any);
      expect(pendencies[0]).toContain('não reconhecida');
    });
  });
});
