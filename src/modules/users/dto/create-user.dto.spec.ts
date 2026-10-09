import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UserRole } from 'src/database/entities/user.entity';
import { CreateUserDto } from './create-user.dto';

describe('CreateUserDto', () => {
  it('deve validar sem role (usa o default do service)', async () => {
    const dto = plainToInstance(CreateUserDto, {
      name: 'Ana Souza',
      email: 'ana@email.com',
      phone: '11999998888',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve validar com role="collaborator"', async () => {
    const dto = plainToInstance(CreateUserDto, {
      name: 'Ana Souza',
      email: 'ana@email.com',
      phone: '11999998888',
      role: UserRole.COLLABORATOR,
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve falhar com role="admin" — não é possível cunhar um segundo dono pelo payload', async () => {
    const dto = plainToInstance(CreateUserDto, {
      name: 'Invasor',
      email: 'invasor@email.com',
      phone: '11988887777',
      role: UserRole.ADMIN,
    });

    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'role')).toBeDefined();
  });

  it('deve falhar com role fora do enum', async () => {
    const dto = plainToInstance(CreateUserDto, {
      name: 'Ana Souza',
      email: 'ana@email.com',
      phone: '11999998888',
      role: 'super-admin',
    });

    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'role')).toBeDefined();
  });
});
