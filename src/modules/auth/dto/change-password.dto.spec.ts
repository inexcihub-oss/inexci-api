import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { changePasswordDto } from './change-password.dto';

describe('changePasswordDto — política de senha forte', () => {
  const passwordError = (errors: Awaited<ReturnType<typeof validate>>) =>
    errors.find((e) => e.property === 'password');

  it('rejeita senha fraca (sem maiúscula/especial)', async () => {
    const dto = plainToInstance(changePasswordDto, {
      email: 'joao@email.com',
      password: '12345678',
    });
    expect(passwordError(await validate(dto))).toBeDefined();
  });

  it('rejeita senha curta mesmo se complexa', async () => {
    const dto = plainToInstance(changePasswordDto, {
      email: 'joao@email.com',
      password: 'Aa@1',
    });
    expect(passwordError(await validate(dto))).toBeDefined();
  });

  it('aceita senha forte', async () => {
    const dto = plainToInstance(changePasswordDto, {
      email: 'joao@email.com',
      password: 'Senha@123',
    });
    expect(passwordError(await validate(dto))).toBeUndefined();
  });
});
