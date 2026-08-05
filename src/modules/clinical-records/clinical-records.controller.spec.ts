import { Reflector } from '@nestjs/core';
import { Permission } from 'src/shared/permissions';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { ClinicalRecordsController } from './clinical-records.controller';
import { ClinicalDocumentsController } from './documents/clinical-documents.controller';
import { ClinicalRecordTemplatesController } from './templates/clinical-record-templates.controller';

describe('Permissões declaradas no módulo de atendimento', () => {
  const reflector = new Reflector();

  it.each([
    ['fichas', ClinicalRecordsController],
    ['documentos', ClinicalDocumentsController],
    ['modelos', ClinicalRecordTemplatesController],
  ])('exige atendimento em %s', (_rotulo, controller) => {
    expect(reflector.get(PERMISSIONS_KEY, controller)).toEqual([
      Permission.ATENDIMENTO,
    ]);
  });
});
