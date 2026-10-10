import { PATH_METADATA } from '@nestjs/common/constants';
import { ClinicalDocumentTemplateKind } from 'src/database/entities/clinical-document-template.entity';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import { ClinicalDocumentTemplatesController } from './clinical-document-templates.controller';

describe('ClinicalDocumentTemplatesController (MIG-06)', () => {
  const templates = {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const generation = { applyTemplate: jest.fn() };
  const controller = new ClinicalDocumentTemplatesController(
    templates as never,
    generation as never,
  );
  const user = { userId: 'doc-1' } as never;

  beforeEach(() => jest.clearAllMocks());

  it('caminho fixo e área Atendimento', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, ClinicalDocumentTemplatesController),
    ).toBe('clinical-records/document-templates');
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, ClinicalDocumentTemplatesController),
    ).toEqual([Permission.ATENDIMENTO]);
  });

  it('lista com filtro de tipo e médico', () => {
    void controller.find(
      ClinicalDocumentTemplateKind.EXAM_REFERRAL,
      undefined,
      user,
    );
    expect(templates.findMany).toHaveBeenCalledWith('doc-1', {
      kind: 'exam_referral',
      doctorId: undefined,
    });
  });

  it('expõe a lista de placeholders com rótulo', () => {
    expect(controller.placeholders()).toContainEqual({
      key: 'paciente.nome',
      label: 'Nome do paciente',
    });
  });

  it('aplicar delega à emissão (mesmo contexto do PDF)', () => {
    void controller.apply('tpl-1', { patientId: 'p-1', restDays: 2 }, user);
    expect(generation.applyTemplate).toHaveBeenCalledWith(
      'tpl-1',
      { patientId: 'p-1', restDays: 2 },
      'doc-1',
    );
  });
});
