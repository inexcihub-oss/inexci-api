import { instanceToPlain } from 'class-transformer';
import { User } from '../../database/entities/user.entity';

describe('User — campos sensiveis na resposta', () => {
  it('nao expoe token de verificacao de e-mail', () => {
    const user = Object.assign(new User(), {
      id: 'u1',
      email: 'a@b.com',
      emailVerificationToken: 'token-secreto',
      emailVerificationExpiresAt: new Date(),
    });

    const plano = instanceToPlain(user) as Record<string, unknown>;

    expect(plano).not.toHaveProperty('emailVerificationToken');
    expect(plano).not.toHaveProperty('emailVerificationExpiresAt');
  });
});
