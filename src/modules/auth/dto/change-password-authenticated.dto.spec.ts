import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ChangePasswordAuthenticatedDto } from './change-password-authenticated.dto';

describe('ChangePasswordAuthenticatedDto — política de senha forte', () => {
  const newPasswordError = (errors: Awaited<ReturnType<typeof validate>>) =>
    errors.find((e) => e.property === 'newPassword');

  it('rejeita nova senha fraca', async () => {
    const dto = plainToInstance(ChangePasswordAuthenticatedDto, {
      currentPassword: 'qualquer',
      newPassword: '12345678',
    });
    expect(newPasswordError(await validate(dto))).toBeDefined();
  });

  it('exige senha atual', async () => {
    const dto = plainToInstance(ChangePasswordAuthenticatedDto, {
      newPassword: 'Senha@123',
    });
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'currentPassword')).toBeDefined();
  });

  it('aceita nova senha forte', async () => {
    const dto = plainToInstance(ChangePasswordAuthenticatedDto, {
      currentPassword: 'qualquer',
      newPassword: 'Senha@123',
    });
    expect(newPasswordError(await validate(dto))).toBeUndefined();
  });
});
