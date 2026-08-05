import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SetUserDoctorAccessDto } from './set-user-doctor-access.dto';

function validar(payload: unknown) {
  return validateSync(
    plainToInstance(SetUserDoctorAccessDto, payload, {
      enableImplicitConversion: false,
    }),
    { whitelist: true, forbidNonWhitelisted: true },
  );
}

const UUID = '6e8c1e4a-2f3b-4a1d-9c1e-8f7a5b3d2c10';

describe('SetUserDoctorAccessDto', () => {
  it('aceita uma lista de UUIDs', () => {
    expect(validar({ doctor_user_ids: [UUID] })).toHaveLength(0);
  });

  it('aceita lista vazia — é assim que se removem todos os vínculos', () => {
    expect(validar({ doctor_user_ids: [] })).toHaveLength(0);
  });

  /**
   * O motivo de o DTO existir: sem ele o corpo chegava sem validação, o
   * service recebia `undefined` e a rota devolvia 500 em vez de 400.
   */
  it('recusa corpo vazio em vez de deixar passar', () => {
    const erros = validar({});
    expect(erros.length).toBeGreaterThan(0);
    expect(erros[0].property).toBe('doctor_user_ids');
  });

  it('recusa quando não é array', () => {
    expect(validar({ doctor_user_ids: UUID }).length).toBeGreaterThan(0);
  });

  it('recusa ids que não são UUID', () => {
    const erros = validar({ doctor_user_ids: ['nao-e-uuid'] });
    expect(erros.length).toBeGreaterThan(0);
    expect(erros[0].property).toBe('doctor_user_ids');
  });

  it('recusa campo desconhecido no corpo', () => {
    expect(
      validar({ doctor_user_ids: [UUID], doctorUserIds: [UUID] }).length,
    ).toBeGreaterThan(0);
  });
});
