import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { FindAppointmentsDto } from './find-appointments.dto';
import { AppointmentStatus } from 'src/database/entities/appointment.entity';

describe('FindAppointmentsDto', () => {
  function transform(payload: Record<string, unknown>) {
    // Reproduz o ValidationPipe global (transform: true).
    return plainToInstance(FindAppointmentsDto, payload, {
      enableImplicitConversion: false,
    });
  }

  it('aceita query sem janela de datas (listas abertas)', () => {
    const dto = transform({ status: 'completed', order: 'DESC' });

    expect(dto.from).toBeUndefined();
    expect(dto.to).toBeUndefined();
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('quebra a lista de status separada por vírgula', () => {
    const dto = transform({ status: 'scheduled,confirmed' });

    expect(dto.status).toEqual([
      AppointmentStatus.SCHEDULED,
      AppointmentStatus.CONFIRMED,
    ]);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejeita status desconhecido', () => {
    const dto = transform({ status: 'scheduled,inventado' });

    expect(validateSync(dto)).not.toHaveLength(0);
  });

  it('rejeita ordem fora de ASC/DESC', () => {
    expect(validateSync(transform({ order: 'asc' }))).not.toHaveLength(0);
    expect(validateSync(transform({ order: 'ASC' }))).toHaveLength(0);
  });

  it('ignora status vazio em vez de virar lista com string vazia', () => {
    const dto = transform({ status: '' });

    expect(dto.status).toBeUndefined();
    expect(validateSync(dto)).toHaveLength(0);
  });
});
