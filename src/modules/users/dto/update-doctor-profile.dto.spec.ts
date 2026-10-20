import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateDoctorProfileDto } from './update-doctor-profile.dto';

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

  it('deve aceitar somente signatureImageUrl (caminho do bucket)', async () => {
    const dto = plainToInstance(UpdateDoctorProfileDto, {
      signatureImageUrl: 'signatures/dono-1/uuid-abc.png',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('aceita signatureImageUrl null (remover a assinatura)', async () => {
    const dto = plainToInstance(UpdateDoctorProfileDto, {
      signatureImageUrl: null,
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    ['URL externa', 'https://storage.example.com/signatures/abc.png'],
    ['foto de paciente', 'patient-photos/dono-1/uuid-foto.webp'],
    ['avatar', 'avatars/dono-1/uuid-foto.png'],
    ['travessia', 'signatures/../patient-photos/dono-1/f.webp'],
    ['subpasta', 'signatures/dono-1/x/f.png'],
    ['sem a pasta da conta', 'signatures/f.png'],
  ])('recusa signatureImageUrl %s', async (_rotulo, caminho) => {
    const dto = plainToInstance(UpdateDoctorProfileDto, {
      signatureImageUrl: caminho,
    });

    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(['signatureImageUrl']);
  });

  it('deve aceitar todos os campos juntos', async () => {
    const dto = plainToInstance(UpdateDoctorProfileDto, {
      crm: '654321',
      crmState: 'RJ',
      specialty: 'Cardiologia',
      signatureImageUrl: 'stamps/dono-1/uuid-sig.png',
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
