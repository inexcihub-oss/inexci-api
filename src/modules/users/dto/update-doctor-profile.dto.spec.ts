import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateDoctorProfileDto } from './update-doctor-profile.dto';

/**
 * PRD: Reformulação Usuários/Permissões — US-007
 * Testa validação do DTO de atualização do perfil médico.
 */
describe('UpdateDoctorProfileDto', () => {
  it('deve validar sem campos (todos opcionais)', async () => {
    const dto = plainToInstance(UpdateDoctorProfileDto, {});

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve aceitar somente crm', async () => {
    const dto = plainToInstance(UpdateDoctorProfileDto, {
      crm: '123456',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve aceitar somente crmState', async () => {
    const dto = plainToInstance(UpdateDoctorProfileDto, {
      crmState: 'SP',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve aceitar somente specialty', async () => {
    const dto = plainToInstance(UpdateDoctorProfileDto, {
      specialty: 'Ortopedia',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve aceitar somente signature_image_url', async () => {
    const dto = plainToInstance(UpdateDoctorProfileDto, {
      signature_image_url: 'https://storage.example.com/signatures/abc.png',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve aceitar todos os campos juntos', async () => {
    const dto = plainToInstance(UpdateDoctorProfileDto, {
      crm: '654321',
      crmState: 'RJ',
      specialty: 'Cardiologia',
      signature_image_url: 'https://storage.example.com/sig.png',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('deve falhar se crm não for string', async () => {
    const dto = plainToInstance(UpdateDoctorProfileDto, {
      crm: 123456,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('deve falhar se crmState não for string', async () => {
    const dto = plainToInstance(UpdateDoctorProfileDto, {
      crmState: true,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
