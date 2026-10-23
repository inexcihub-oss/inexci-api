import { PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import { ClinicalRecordsController } from '../clinical-records.controller';
import { ClinicalRecordsModule } from '../clinical-records.module';
import { ClinicalSnippetsController } from './clinical-snippets.controller';
import { CreateClinicalSnippetDto } from './dto/create-clinical-snippet.dto';

describe('ClinicalSnippetsController', () => {
  const snippets = {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    registerUse: jest.fn(),
  };
  const controller = new ClinicalSnippetsController(snippets as never);
  const user = { userId: 'doc-1' } as never;

  beforeEach(() => jest.clearAllMocks());

  it('caminho fixo, área Atendimento e registrado antes de clinical-records/:id', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ClinicalSnippetsController)).toBe(
      'clinical-records/snippets',
    );
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, ClinicalSnippetsController),
    ).toEqual([Permission.ATENDIMENTO]);
    const controllers: unknown[] =
      Reflect.getMetadata('controllers', ClinicalRecordsModule) ?? [];
    expect(controllers.indexOf(ClinicalSnippetsController)).toBeGreaterThan(-1);
    expect(controllers.indexOf(ClinicalSnippetsController)).toBeLessThan(
      controllers.indexOf(ClinicalRecordsController),
    );
  });

  it('delega com o usuário logado', () => {
    void controller.find(user);
    expect(snippets.findMany).toHaveBeenCalledWith('doc-1');
    void controller.use('sn-1', user);
    expect(snippets.registerUse).toHaveBeenCalledWith('sn-1', 'doc-1');
  });
});

describe('CreateClinicalSnippetDto', () => {
  const validar = (shortcut: string) => {
    const dto = plainToInstance(CreateClinicalSnippetDto, {
      shortcut,
      title: 'Exame normal',
      content: '<p>ok</p>',
    });
    return validate(dto).then((erros) => ({ dto, erros }));
  };

  it('normaliza barra, maiúsculas e espaços do atalho', async () => {
    const { dto, erros } = await validar(' /Exame-Normal ');
    expect(erros).toHaveLength(0);
    expect(dto.shortcut).toBe('exame-normal');
  });

  it.each(['dor lombar', 'exame_normal', 'joelhoé', '-normal', ''])(
    'recusa o atalho %p',
    async (shortcut) => {
      const { erros } = await validar(shortcut);
      expect(erros.map((e) => e.property)).toContain('shortcut');
    },
  );
});
