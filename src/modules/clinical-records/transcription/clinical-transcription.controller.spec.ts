import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSIONS_KEY } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import { ClinicalRecordsController } from '../clinical-records.controller';
import { ClinicalRecordsModule } from '../clinical-records.module';
import { ClinicalTranscriptionController } from './clinical-transcription.controller';
import { DitadoLiberadoGuard } from './ditado-liberado.guard';

describe('ClinicalTranscriptionController', () => {
  it('caminho fixo, área Atendimento e registrado antes de clinical-records/:id', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, ClinicalTranscriptionController),
    ).toBe('clinical-records/transcribe');
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, ClinicalTranscriptionController),
    ).toEqual([Permission.ATENDIMENTO]);
    const controllers: unknown[] =
      Reflect.getMetadata('controllers', ClinicalRecordsModule) ?? [];
    expect(
      controllers.indexOf(ClinicalTranscriptionController),
    ).toBeGreaterThan(-1);
    expect(controllers.indexOf(ClinicalTranscriptionController)).toBeLessThan(
      controllers.indexOf(ClinicalRecordsController),
    );
  });

  it('confere a liberação do ditado num guard, antes de o upload ser lido', () => {
    const guards: unknown[] = Reflect.getMetadata(
      GUARDS_METADATA,
      ClinicalTranscriptionController.prototype.transcribe,
    );
    expect(guards).toEqual([DitadoLiberadoGuard]);
  });

  it('repassa o arquivo ao service', () => {
    const service = { transcribe: jest.fn() };
    const controller = new ClinicalTranscriptionController(service as never);
    const file = { size: 10 } as Express.Multer.File;
    void controller.transcribe(file);
    expect(service.transcribe).toHaveBeenCalledWith(file);
  });
});
