import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ResetCollaboratorPasswordDto } from './reset-collaborator-password.dto';

describe('ResetCollaboratorPasswordDto', () => {
  it('recusa senha fraca', () => {
    const dto = plainToInstance(ResetCollaboratorPasswordDto, {
      password: '1',
    });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('recusa corpo sem senha', () => {
    const dto = plainToInstance(ResetCollaboratorPasswordDto, {});
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('aceita senha forte', () => {
    const dto = plainToInstance(ResetCollaboratorPasswordDto, {
      password: 'SenhaForte123@',
    });
    expect(validateSync(dto)).toHaveLength(0);
  });
});
