import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegisterDto } from './register.dto';

/**
 * PRD: Reformulação Usuários/Permissões — US-003 e US-007
 * Valida que o RegisterDto aceita campos de médico opcionais.
 */
describe('RegisterDto', () => {
  it('deve validar com dados mínimos obrigatórios (incluindo telefone)', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'João Silva',
      email: 'joao@email.com',
      password: 'Senha@123',
      phone: '(11) 98888-7777',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve falhar sem nome', async () => {
    const dto = plainToInstance(RegisterDto, {
      email: 'joao@email.com',
      password: 'Senha@123',
      phone: '(11) 98888-7777',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('deve falhar com email inválido', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'João',
      email: 'not-an-email',
      password: 'Senha@123',
      phone: '(11) 98888-7777',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('deve falhar com senha menor que 8 caracteres', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'João',
      email: 'joao@email.com',
      password: '123',
      phone: '(11) 98888-7777',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  describe('política de senha forte', () => {
    const baseDto = {
      name: 'João',
      email: 'joao@email.com',
      phone: '(11) 98888-7777',
    };

    const passwordError = (errors: Awaited<ReturnType<typeof validate>>) =>
      errors.find((e) => e.property === 'password');

    it('rejeita senha sem maiúscula', async () => {
      const dto = plainToInstance(RegisterDto, {
        ...baseDto,
        password: 'senha@123',
      });
      expect(passwordError(await validate(dto))).toBeDefined();
    });

    it('rejeita senha sem minúscula', async () => {
      const dto = plainToInstance(RegisterDto, {
        ...baseDto,
        password: 'SENHA@123',
      });
      expect(passwordError(await validate(dto))).toBeDefined();
    });

    it('rejeita senha sem número', async () => {
      const dto = plainToInstance(RegisterDto, {
        ...baseDto,
        password: 'SenhaForte@',
      });
      expect(passwordError(await validate(dto))).toBeDefined();
    });

    it('rejeita senha sem caractere especial', async () => {
      const dto = plainToInstance(RegisterDto, {
        ...baseDto,
        password: 'SenhaForte123',
      });
      expect(passwordError(await validate(dto))).toBeDefined();
    });

    it('rejeita senha complexa porém com menos de 8 caracteres', async () => {
      const dto = plainToInstance(RegisterDto, {
        ...baseDto,
        password: 'Aa@1',
      });
      expect(passwordError(await validate(dto))).toBeDefined();
    });

    it('aceita senha que cumpre todos os requisitos', async () => {
      const dto = plainToInstance(RegisterDto, {
        ...baseDto,
        password: 'Senha@123',
      });
      expect(passwordError(await validate(dto))).toBeUndefined();
    });
  });

  it('deve falhar quando o telefone não é informado', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'João Silva',
      email: 'joao@email.com',
      password: 'Senha@123',
    });

    const errors = await validate(dto);
    const phoneError = errors.find((e) => e.property === 'phone');
    expect(phoneError).toBeDefined();
  });

  it('deve falhar quando o telefone não tem DDD/dígitos suficientes', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'João Silva',
      email: 'joao@email.com',
      password: 'Senha@123',
      phone: '12345',
    });

    const errors = await validate(dto);
    const phoneError = errors.find((e) => e.property === 'phone');
    expect(phoneError).toBeDefined();
  });

  it('aceita telefone com 10 dígitos (fixo) e 11 dígitos (celular)', async () => {
    const dtoFixo = plainToInstance(RegisterDto, {
      name: 'João Silva',
      email: 'joao@email.com',
      password: 'Senha@123',
      phone: '1122334455',
    });
    expect(await validate(dtoFixo)).toHaveLength(0);

    const dtoCelular = plainToInstance(RegisterDto, {
      name: 'João Silva',
      email: 'joao2@email.com',
      password: 'Senha@123',
      phone: '(11) 98888-7777',
    });
    expect(await validate(dtoCelular)).toHaveLength(0);
  });

  it('deve aceitar isDoctor como true com crm e crmState', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Dr. Carlos',
      email: 'carlos@email.com',
      password: 'Senha@123',
      phone: '(11) 98888-7777',
      isDoctor: true,
      crm: '123456',
      crmState: 'SP',
      specialty: 'Ortopedia',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve falhar se isDoctor=true sem crm', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Dr. Carlos',
      email: 'carlos@email.com',
      password: 'Senha@123',
      phone: '(11) 98888-7777',
      isDoctor: true,
      // crm ausente
      crmState: 'SP',
    });

    const errors = await validate(dto);
    const crmError = errors.find((e) => e.property === 'crm');
    expect(crmError).toBeDefined();
  });

  it('deve falhar se isDoctor=true sem crmState', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Dr. Carlos',
      email: 'carlos@email.com',
      password: 'Senha@123',
      phone: '(11) 98888-7777',
      isDoctor: true,
      crm: '123456',
      // crmState ausente
    });

    const errors = await validate(dto);
    const crmStateError = errors.find((e) => e.property === 'crmState');
    expect(crmStateError).toBeDefined();
  });

  it('deve aceitar isDoctor como false sem crm/crmState', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Maria',
      email: 'maria@email.com',
      password: 'Senha@123',
      phone: '(11) 98888-7777',
      isDoctor: false,
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve aceitar sem isDoctor (campo opcional)', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Pedro',
      email: 'pedro@email.com',
      password: 'Senha@123',
      phone: '(11) 98888-7777',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
