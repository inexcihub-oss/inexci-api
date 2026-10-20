import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthDto } from 'src/modules/auth/dto/auth.dto';
import { CreateCollaboratorDto } from 'src/modules/users/dto/create-collaborator.dto';
import { normalizarEmail } from './normalize-email.decorator';

describe('normalização de e-mail', () => {
  it('normalizarEmail tira espaços e passa para minúsculas', () => {
    expect(normalizarEmail('  Fulano.Silva@Exemplo.COM ')).toBe(
      'fulano.silva@exemplo.com',
    );
    expect(normalizarEmail(null)).toBeNull();
    expect(normalizarEmail(undefined)).toBeUndefined();
  });

  it('o DTO de login recebe o e-mail já normalizado e válido', async () => {
    const dto = plainToInstance(AuthDto, {
      email: ' Medico@Inexci.COM ',
      password: 'x',
    });

    expect(dto.email).toBe('medico@inexci.com');
    expect(await validate(dto)).toEqual([]);
  });

  it('o DTO de convite de colaborador também normaliza', () => {
    const dto = plainToInstance(CreateCollaboratorDto, {
      email: 'Secretaria@Clinica.com',
    });

    expect(dto.email).toBe('secretaria@clinica.com');
  });
});
