import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateProfileDto } from './update-profile.dto';

describe('UpdateProfileDto — caminhos de arquivo', () => {
  const erros = async (dados: Record<string, unknown>) =>
    (await validate(plainToInstance(UpdateProfileDto, dados))).map(
      (e) => e.property,
    );

  it.each([
    [{ avatarUrl: 'avatars/dono-1/uuid-foto.png' }],
    [{ avatarUrl: null }],
    [{ avatarUrl: '' }],
    [{ signatureUrl: 'signatures/dono-1/uuid-ass.png' }],
    [{ signatureUrl: 'stamps/dono-1/uuid-car.png' }],
    [{ signatureUrl: null }],
  ])('aceita %o', async (dados) => {
    expect(await erros(dados)).toEqual([]);
  });

  it.each([
    ['avatar apontando para foto de paciente', 'patient-photos/dono-1/f.webp'],
    ['avatar apontando para documento', 'documents/dono-1/laudo.pdf'],
    ['avatar com URL externa', 'https://exemplo.com/a.png'],
  ])('recusa %s', async (_rotulo, avatarUrl) => {
    expect(await erros({ avatarUrl })).toEqual(['avatarUrl']);
  });

  it.each([
    ['URL do R2', 'https://conta.r2.cloudflarestorage.com/bucket/x.png'],
    ['foto de paciente', 'patient-photos/dono-1/f.webp'],
    ['travessia', 'signatures/../patient-photos/dono-1/f.webp'],
  ])('recusa signatureUrl %s', async (_rotulo, signatureUrl) => {
    expect(await erros({ signatureUrl })).toEqual(['signatureUrl']);
  });
});
