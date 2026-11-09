import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from 'src/shared/decorators/is-public.decorator';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { SKIP_CONSENT_CHECK_KEY } from 'src/shared/guards/consents.guard';
import { CronController } from 'src/shared/cron/cron.controller';
import { NotificationsHealthController } from 'src/modules/notifications/health/notifications-health.controller';
import { AdminController } from './admin.controller';
import { PlatformAuditController } from './audit/platform-audit.controller';
import { AdminAccountsController } from './accounts/admin-accounts.controller';
import { AdminSubscriptionsController } from './subscriptions/admin-subscriptions.controller';
import { AdminTeamController } from './team/admin-team.controller';
import { AdminUsageController } from './usage/admin-usage.controller';
import { AdminRevenueController } from './revenue/admin-revenue.controller';
import { AdminCouponsController } from './coupons/admin-coupons.controller';
import { AdminMetricsController } from './metrics/admin-metrics.controller';
import { AdminSystemController } from './system/admin-system.controller';
import { AdminErrorsController } from './errors/admin-errors.controller';
import { AdminQueuesController } from './queues/admin-queues.controller';
import { AdminGatewayEventsController } from './gateway-events/admin-gateway-events.controller';
import { AdminSecurityController } from './security/admin-security.controller';
import { AdminClinicalAccessController } from './clinical-access/admin-clinical-access.controller';
import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminSessionGuard } from './auth/admin-session.guard';

type Classe = abstract new (...args: never[]) => unknown;

const CONTROLLERS_DO_PAINEL: Classe[] = [
  AdminController,
  PlatformAuditController,
  AdminAccountsController,
  AdminSubscriptionsController,
  AdminTeamController,
  AdminUsageController,
  AdminRevenueController,
  AdminCouponsController,
  AdminMetricsController,
  AdminSystemController,
  AdminErrorsController,
  AdminQueuesController,
  AdminGatewayEventsController,
  AdminSecurityController,
  AdminClinicalAccessController,
  CronController,
];

const ROTAS_PUBLICAS_DO_LOGIN = [
  'login',
  'mfaSetup',
  'mfaEnable',
  'loginMfa',
  'refresh',
  'logout',
  'acceptInvite',
];

const ROTAS_AUTENTICADAS_DO_LOGIN = ['me', 'recoveryCodes'];

function handlers(alvo: Classe): Array<{ nome: string; fn: object }> {
  const proto = alvo.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((nome) => nome !== 'constructor')
    .map((nome) => ({
      nome,
      fn: Object.getOwnPropertyDescriptor(proto, nome)?.value as object,
    }))
    .filter(
      ({ fn }) =>
        typeof fn === 'function' &&
        Reflect.getMetadata(PATH_METADATA, fn) !== undefined,
    );
}

function guardsEfetivos(alvo: Classe, fn: object): unknown[] {
  return [
    ...((Reflect.getMetadata(GUARDS_METADATA, alvo) as unknown[]) ?? []),
    ...((Reflect.getMetadata(GUARDS_METADATA, fn) as unknown[]) ?? []),
  ];
}

function metadado(chave: string, alvo: Classe, fn: object): unknown {
  return (
    (Reflect.getMetadata(chave, fn) as unknown) ??
    (Reflect.getMetadata(chave, alvo) as unknown)
  );
}

function controllersComPrefixoAdmin(): string[] {
  const raiz = join(__dirname, '..', '..');
  const varrer = (dir: string): string[] =>
    readdirSync(dir).flatMap((nome) => {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) return varrer(caminho);
      return caminho.endsWith('.controller.ts') ? [caminho] : [];
    });
  return varrer(raiz)
    .filter((f) => /@Controller\(\s*['"]admin/.test(readFileSync(f, 'utf8')))
    .map((f) => f.slice(raiz.length + 1))
    .sort();
}

describe('segurança das rotas do painel administrativo', () => {
  describe.each(CONTROLLERS_DO_PAINEL.map((c) => [c.name, c] as const))(
    '%s',
    (_nome, alvo) => {
      it('tem rotas', () => {
        expect(handlers(alvo).length).toBeGreaterThan(0);
      });

      it.each(handlers(alvo).map((h) => [h.nome, h.fn] as const))(
        '%s usa @PlatformAdminOnly (sessão do painel, sem JWT, consentimento nem área da clínica)',
        (_rota, fn) => {
          const guards = guardsEfetivos(alvo, fn);
          expect(guards).toContain(AdminSessionGuard);
          expect(metadado(IS_PUBLIC_KEY, alvo, fn)).toBe(true);
          expect(metadado(SKIP_CONSENT_CHECK_KEY, alvo, fn)).toBe(true);
          expect(metadado(PERMISSIONS_KEY, alvo, fn)).toBeUndefined();
        },
      );
    },
  );

  it('no login do painel só as etapas sem sessão são públicas sem guard', () => {
    const rotas = handlers(AdminAuthController);
    expect(rotas.map((r) => r.nome).sort()).toEqual(
      [...ROTAS_PUBLICAS_DO_LOGIN, ...ROTAS_AUTENTICADAS_DO_LOGIN].sort(),
    );
    for (const { nome, fn } of rotas) {
      const guards = guardsEfetivos(AdminAuthController, fn);
      expect(metadado(IS_PUBLIC_KEY, AdminAuthController, fn)).toBe(true);
      expect(metadado(SKIP_CONSENT_CHECK_KEY, AdminAuthController, fn)).toBe(
        true,
      );
      if (ROTAS_AUTENTICADAS_DO_LOGIN.includes(nome)) {
        expect(guards).toContain(AdminSessionGuard);
      } else {
        expect(guards).not.toContain(AdminSessionGuard);
      }
    }
  });

  it('todo controller com prefixo admin está na lista verificada', () => {
    expect(controllersComPrefixoAdmin()).toEqual(
      [
        'modules/admin/admin.controller.ts',
        'modules/admin/audit/platform-audit.controller.ts',
        'modules/admin/accounts/admin-accounts.controller.ts',
        'modules/admin/subscriptions/admin-subscriptions.controller.ts',
        'modules/admin/team/admin-team.controller.ts',
        'modules/admin/usage/admin-usage.controller.ts',
        'modules/admin/revenue/admin-revenue.controller.ts',
        'modules/admin/coupons/admin-coupons.controller.ts',
        'modules/admin/metrics/admin-metrics.controller.ts',
        'modules/admin/system/admin-system.controller.ts',
        'modules/admin/errors/admin-errors.controller.ts',
        'modules/admin/queues/admin-queues.controller.ts',
        'modules/admin/gateway-events/admin-gateway-events.controller.ts',
        'modules/admin/security/admin-security.controller.ts',
        'modules/admin/clinical-access/admin-clinical-access.controller.ts',
        'modules/admin/auth/admin-auth.controller.ts',
        'shared/cron/cron.controller.ts',
      ].sort(),
    );
  });

  it('nenhum arquivo de src usa mais o PlatformAdminGuard antigo', () => {
    const raiz = join(__dirname, '..', '..');
    const varrer = (dir: string): string[] =>
      readdirSync(dir).flatMap((nome) => {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) return varrer(caminho);
        return /\.ts$/.test(caminho) && !/\.spec\.ts$/.test(caminho)
          ? [caminho]
          : [];
      });
    const usos = varrer(raiz)
      .filter((f) => readFileSync(f, 'utf8').includes('PlatformAdminGuard'))
      .map((f) => f.slice(raiz.length + 1));
    expect(usos).toEqual([]);
  });

  describe('saúde das notificações', () => {
    const rota = (nome: string) =>
      Object.getOwnPropertyDescriptor(
        NotificationsHealthController.prototype,
        nome,
      )?.value as object;

    it('o detalhe usa @PlatformAdminOnly', () => {
      const fn = rota('details');
      expect(Reflect.getMetadata(GUARDS_METADATA, fn)).toEqual([
        AdminSessionGuard,
      ]);
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, fn)).toBe(true);
      expect(Reflect.getMetadata(SKIP_CONSENT_CHECK_KEY, fn)).toBe(true);
    });

    it('o resumo continua público e sem guard', () => {
      const fn = rota('check');
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, fn)).toBe(true);
      expect(Reflect.getMetadata(GUARDS_METADATA, fn)).toBeUndefined();
    });
  });
});
