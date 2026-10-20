import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetHasOpmeDto } from './set-has-opme.dto';
import {
  CreateSurgeryRequestTemplateDto,
  UpdateSurgeryRequestTemplateDto,
} from './surgery-request-template.dto';

const erros = async <T extends object>(cls: new () => T, body: object) =>
  (await validate(plainToInstance(cls, body))).map((e) => e.property);

describe('DTOs dos corpos que eram inline no controller de SC', () => {
  it('SetHasOpmeDto exige boolean', async () => {
    await expect(erros(SetHasOpmeDto, { hasOpme: true })).resolves.toEqual([]);
    await expect(erros(SetHasOpmeDto, { hasOpme: 'sim' })).resolves.toEqual([
      'hasOpme',
    ]);
    await expect(erros(SetHasOpmeDto, {})).resolves.toEqual(['hasOpme']);
  });

  it('CreateSurgeryRequestTemplateDto exige nome (≤ 100) e templateData objeto', async () => {
    await expect(
      erros(CreateSurgeryRequestTemplateDto, {
        name: 'Artroscopia',
        templateData: { tuss: [] },
      }),
    ).resolves.toEqual([]);
    await expect(
      erros(CreateSurgeryRequestTemplateDto, {
        name: 'x'.repeat(101),
        templateData: 'texto',
      }),
    ).resolves.toEqual(['name', 'templateData']);
  });

  it('UpdateSurgeryRequestTemplateDto aceita atualização parcial', async () => {
    await expect(
      erros(UpdateSurgeryRequestTemplateDto, { name: 'Novo nome' }),
    ).resolves.toEqual([]);
    await expect(
      erros(UpdateSurgeryRequestTemplateDto, { name: '' }),
    ).resolves.toEqual(['name']);
  });
});
