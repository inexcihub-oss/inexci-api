import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateCollaboratorDto } from './create-collaborator.dto';

/**
 * PRD: Reformulação Usuários/Permissões — US-004
 * Testa validação do DTO de criação de colaborador.
 */
describe('CreateCollaboratorDto', () => {
  it('deve validar com dados mínimos (name + email)', async () => {
    const dto = plainToInstance(CreateCollaboratorDto, {
      name: 'Ana Souza',
      email: 'ana@email.com',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve falhar sem name', async () => {
    const dto = plainToInstance(CreateCollaboratorDto, {
      email: 'ana@email.com',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === 'name')).toBeDefined();
  });

  it('deve falhar sem email', async () => {
    const dto = plainToInstance(CreateCollaboratorDto, {
      name: 'Ana Souza',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.find((e) => e.property === 'email')).toBeDefined();
  });

  it('deve falhar com email inválido', async () => {
    const dto = plainToInstance(CreateCollaboratorDto, {
      name: 'Ana',
      email: 'not-valid',
    });

    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'email')).toBeDefined();
  });

  it('deve aceitar phone opcional', async () => {
    const dto = plainToInstance(CreateCollaboratorDto, {
      name: 'Ana',
      email: 'ana@email.com',
      phone: '11999998888',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve aceitar isDoctor=true com crm e crmState', async () => {
    const dto = plainToInstance(CreateCollaboratorDto, {
      name: 'Dr. Pedro',
      email: 'pedro@email.com',
      isDoctor: true,
      crm: '654321',
      crmState: 'RJ',
      specialty: 'Cardiologia',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve falhar se isDoctor=true sem crm', async () => {
    const dto = plainToInstance(CreateCollaboratorDto, {
      name: 'Dr. Pedro',
      email: 'pedro@email.com',
      isDoctor: true,
      crmState: 'RJ',
    });

    const errors = await validate(dto);
    const crmError = errors.find((e) => e.property === 'crm');
    expect(crmError).toBeDefined();
  });

  it('deve falhar se isDoctor=true sem crmState', async () => {
    const dto = plainToInstance(CreateCollaboratorDto, {
      name: 'Dr. Pedro',
      email: 'pedro@email.com',
      isDoctor: true,
      crm: '654321',
    });

    const errors = await validate(dto);
    const crmStateError = errors.find((e) => e.property === 'crmState');
    expect(crmStateError).toBeDefined();
  });

  it('deve aceitar isDoctor=false sem crm', async () => {
    const dto = plainToInstance(CreateCollaboratorDto, {
      name: 'Secretária Maria',
      email: 'maria@email.com',
      isDoctor: false,
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve aceitar sem isDoctor (padrão)', async () => {
    const dto = plainToInstance(CreateCollaboratorDto, {
      name: 'Carlos',
      email: 'carlos@email.com',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
