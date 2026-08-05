import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateClinicalRecordDto } from './create-clinical-record.dto';

const patientId = '11111111-1111-4111-8111-111111111111';

describe('CreateClinicalRecordDto', () => {
  const validate = (payload: Record<string, unknown>) =>
    validateSync(plainToInstance(CreateClinicalRecordDto, payload));

  it('aceita o marcador booleano', () => {
    expect(validate({ patientId, surgicalIndication: true })).toHaveLength(0);
  });

  it('aceita payload sem o marcador', () => {
    expect(validate({ patientId })).toHaveLength(0);
  });

  it('rejeita marcador que não é booleano', () => {
    const errors = validate({ patientId, surgicalIndication: 'sim' });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('surgicalIndication');
  });
});
