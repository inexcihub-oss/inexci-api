import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AiConsentGuard } from './ai-consent.guard';
import { SurgeryRequestsController } from 'src/modules/surgery-requests/surgery-requests.controller';

function ctx(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

describe('AiConsentGuard', () => {
  const guard = new AiConsentGuard();

  it('bloqueia quem não autorizou o uso de IA', () => {
    expect(() =>
      guard.canActivate(ctx({ userId: 'u1', aiConsentAcceptedAt: null })),
    ).toThrow(ForbiddenException);
  });

  it('devolve o código AI_CONSENT_REQUIRED', () => {
    try {
      guard.canActivate(ctx({ userId: 'u1' }));
      fail('deveria lançar');
    } catch (erro) {
      expect((erro as ForbiddenException).getResponse()).toEqual(
        expect.objectContaining({ error: 'AI_CONSENT_REQUIRED' }),
      );
    }
  });

  it('bloqueia request sem usuário', () => {
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });

  it('libera quem autorizou', () => {
    expect(
      guard.canActivate(
        ctx({ userId: 'u1', aiConsentAcceptedAt: new Date('2026-01-01') }),
      ),
    ).toBe(true);
  });
});

describe('rotas HTTP que chamam IA exigem consentimento', () => {
  it('POST /surgery-requests/extract-from-document usa o AiConsentGuard', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      SurgeryRequestsController.prototype.extractFromDocument,
    ) as unknown[];
    expect(guards).toContain(AiConsentGuard);
  });
});
