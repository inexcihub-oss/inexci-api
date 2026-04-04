import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegisterDto } from './register.dto';

/**
 * PRD: Reformulação Usuários/Permissões — US-003 e US-007
 * Valida que o RegisterDto aceita campos de médico opcionais.
 */
describe('RegisterDto', () => {
  it('deve validar com dados mínimos obrigatórios', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'João Silva',
      email: 'joao@email.com',
      password: '12345678',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve falhar sem nome', async () => {
    const dto = plainToInstance(RegisterDto, {
      email: 'joao@email.com',
      password: '12345678',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('deve falhar com email inválido', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'João',
      email: 'not-an-email',
      password: '12345678',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('deve falhar com senha menor que 8 caracteres', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'João',
      email: 'joao@email.com',
      password: '123',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('deve aceitar is_doctor como true com crm e crm_state', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Dr. Carlos',
      email: 'carlos@email.com',
      password: '12345678',
      is_doctor: true,
      crm: '123456',
      crm_state: 'SP',
      specialty: 'Ortopedia',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve falhar se is_doctor=true sem crm', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Dr. Carlos',
      email: 'carlos@email.com',
      password: '12345678',
      is_doctor: true,
      // crm ausente
      crm_state: 'SP',
    });

    const errors = await validate(dto);
    const crmError = errors.find((e) => e.property === 'crm');
    expect(crmError).toBeDefined();
  });

  it('deve falhar se is_doctor=true sem crm_state', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Dr. Carlos',
      email: 'carlos@email.com',
      password: '12345678',
      is_doctor: true,
      crm: '123456',
      // crm_state ausente
    });

    const errors = await validate(dto);
    const crmStateError = errors.find((e) => e.property === 'crm_state');
    expect(crmStateError).toBeDefined();
  });

  it('deve aceitar is_doctor como false sem crm/crm_state', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Maria',
      email: 'maria@email.com',
      password: '12345678',
      is_doctor: false,
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve aceitar sem is_doctor (campo opcional)', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'Pedro',
      email: 'pedro@email.com',
      password: '12345678',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
