import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CANCELLATION_REASON_MAX_LENGTH,
  UpdateAppointmentStatusDto,
} from './update-appointment-status.dto';
import { AppointmentStatus } from 'src/database/entities/appointment.entity';

/**
 * ST-09: `PATCH /appointments/:id/status` aceitava um `cancellationReason` de
 * 10.001 caracteres e gravava inteiro — a coluna é `text`, então nada barrava.
 */
describe('UpdateAppointmentStatusDto', () => {
  function transform(payload: Record<string, unknown>) {
    // Reproduz o ValidationPipe global (transform: true).
    return plainToInstance(UpdateAppointmentStatusDto, payload);
  }

  it('aceita cancelamento sem motivo', () => {
    const dto = transform({ status: AppointmentStatus.CANCELLED });

    expect(validateSync(dto)).toHaveLength(0);
  });

  it('aceita um motivo de tamanho normal', () => {
    const dto = transform({
      status: AppointmentStatus.CANCELLED,
      cancellationReason: 'Paciente desmarcou por telefone.',
    });

    expect(validateSync(dto)).toHaveLength(0);
  });

  it('aceita exatamente o limite', () => {
    const dto = transform({
      status: AppointmentStatus.CANCELLED,
      cancellationReason: 'x'.repeat(CANCELLATION_REASON_MAX_LENGTH),
    });

    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejeita um caractere acima do limite', () => {
    const dto = transform({
      status: AppointmentStatus.CANCELLED,
      cancellationReason: 'x'.repeat(CANCELLATION_REASON_MAX_LENGTH + 1),
    });

    const erros = validateSync(dto);

    expect(erros).toHaveLength(1);
    expect(erros[0].property).toBe('cancellationReason');
    expect(Object.values(erros[0].constraints ?? {}).join(' ')).toContain(
      `${CANCELLATION_REASON_MAX_LENGTH} caracteres`,
    );
  });

  it('rejeita o motivo gigante que passava antes (10.001 caracteres)', () => {
    const dto = transform({
      status: AppointmentStatus.CANCELLED,
      cancellationReason: 'x'.repeat(10_001),
    });

    expect(validateSync(dto)).not.toHaveLength(0);
  });

  it('continua exigindo um status válido', () => {
    expect(validateSync(transform({ status: 'inventado' }))).not.toHaveLength(
      0,
    );
  });
});
