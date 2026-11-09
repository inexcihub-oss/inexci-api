import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { AdminRefreshTokenStore } from './admin-refresh-token.store';
import {
  ADMIN_INVITE_TTL_MS,
  buildAdminInviteLink,
  generateAdminInvite,
  hashInviteToken,
  inviteTokenConfere,
} from './admin-invite.util';
import { AdminAcceptInviteDto, AdminLoginDto } from './dto/admin-auth.dto';

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    status: 'ready',
  })),
}));

describe('convite do painel', () => {
  it('gera token aleatório, guarda só o hash e expira em 24 h', () => {
    const agora = Date.UTC(2026, 9, 27);
    const a = generateAdminInvite(agora);
    const b = generateAdminInvite(agora);

    expect(a.token).not.toBe(b.token);
    expect(a.invite.inviteTokenHash).toBe(hashInviteToken(a.token));
    expect(a.invite.inviteTokenHash).not.toContain(a.token);
    expect(a.invite.inviteExpiresAt.getTime()).toBe(
      agora + ADMIN_INVITE_TTL_MS,
    );
    expect(ADMIN_INVITE_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('confere o token pelo hash', () => {
    const { token, invite } = generateAdminInvite();

    expect(inviteTokenConfere(token, invite.inviteTokenHash)).toBe(true);
    expect(inviteTokenConfere(`${token}x`, invite.inviteTokenHash)).toBe(false);
    expect(inviteTokenConfere(token, null)).toBe(false);
  });

  it('monta o link do primeiro acesso do painel com e-mail e token no fragmento', () => {
    expect(
      buildAdminInviteLink('https://app.inexci.com.br/', 'a+b@x.com', 'tok'),
    ).toBe(
      'https://app.inexci.com.br/admin/primeiro-acesso#email=a%2Bb%40x.com&token=tok',
    );
  });
});

describe('DTOs do login do painel', () => {
  it('aceite de convite exige senha forte', async () => {
    const fraca = plainToInstance(AdminAcceptInviteDto, {
      email: 'a@x.com',
      token: 'tok',
      password: 'fraca123',
    });
    const forte = plainToInstance(AdminAcceptInviteDto, {
      email: ' A@X.com ',
      token: 'tok',
      password: 'Teste123@',
    });

    expect(await validate(fraca)).not.toHaveLength(0);
    expect(await validate(forte)).toHaveLength(0);
    expect(forte.email).toBe('a@x.com');
  });

  it('login normaliza o e-mail', async () => {
    const dto = plainToInstance(AdminLoginDto, {
      email: ' Ana@Inexci.COM ',
      password: 'x',
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.email).toBe('ana@inexci.com');
  });
});

describe('AdminRefreshTokenStore', () => {
  it('usa chaves Redis próprias, separadas das da clínica', () => {
    const store = new AdminRefreshTokenStore({
      get: jest.fn((_chave: string, padrao?: unknown) => padrao),
    } as unknown as ConfigService);
    const chaves = store as unknown as {
      tokenKey(hash: string): string;
      userKey(id: string): string;
    };

    expect(chaves.tokenKey('h')).toBe('admin_refresh:tok:h');
    expect(chaves.userKey('a1')).toBe('admin_refresh:user:a1');
  });
});
