import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UserRole } from 'src/database/entities/user.entity';
import { CreateUserDto } from './create-user.dto';

/**
 * C1 (revisão da Tarefa 6): `POST /users` é gateado por
 * Permission.ADMINISTRACAO — que o admin delegado (role='collaborator')
 * também tem. Antes, `role` aceitava qualquer `UserRole`, permitindo que um
 * delegado cunhasse um usuário `role: 'admin'` dentro da própria conta. O
 * DTO agora só aceita `collaborator`; `UsersService.create` também ignora o
 * campo por segurança (defesa em profundidade — ver users.service.spec.ts).
 */
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
