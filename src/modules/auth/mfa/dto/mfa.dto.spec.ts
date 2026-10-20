import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  DisableMfaDto,
  LoginMfaDto,
  MfaAnyCodeDto,
  MfaTotpCodeDto,
} from './mfa.dto';

async function erros<T extends object>(cls: new () => T, dados: object) {
  return validate(plainToInstance(cls, dados));
}

describe('DTOs do MFA', () => {
  it('TOTP aceita 6 dígitos (com espaço no meio) e recusa o resto', async () => {
    expect(await erros(MfaTotpCodeDto, { code: '123456' })).toHaveLength(0);
    expect(await erros(MfaTotpCodeDto, { code: '123 456' })).toHaveLength(0);
    expect(await erros(MfaTotpCodeDto, { code: '12345' })).not.toHaveLength(0);
    expect(
      await erros(MfaTotpCodeDto, { code: 'ABCDE-FGH23' }),
    ).not.toHaveLength(0);
  });

  it('código genérico aceita TOTP e código de recuperação', async () => {
    expect(await erros(MfaAnyCodeDto, { code: '123456' })).toHaveLength(0);
    expect(await erros(MfaAnyCodeDto, { code: 'ABCDE-FGH23' })).toHaveLength(0);
    expect(await erros(MfaAnyCodeDto, { code: "1' OR 1=1" })).not.toHaveLength(
      0,
    );
  });

  it('login MFA exige o token da primeira etapa', async () => {
    expect(await erros(LoginMfaDto, { code: '123456' })).not.toHaveLength(0);
    expect(
      await erros(LoginMfaDto, { code: '123456', mfaToken: 'a.b.c' }),
    ).toHaveLength(0);
  });

  it('desativar exige senha', async () => {
    expect(await erros(DisableMfaDto, { code: '123456' })).not.toHaveLength(0);
    expect(
      await erros(DisableMfaDto, { code: '123456', password: 'x' }),
    ).toHaveLength(0);
  });
});
