import { Logger } from '@nestjs/common';
import { AppointmentActivityType } from 'src/database/entities/appointment-activity.entity';
import { AppointmentActivityRepository } from 'src/database/repositories/appointment-activity.repository';

export interface RegistroDeHistorico {
  appointmentId: string;
  userId: string | null;
  type: AppointmentActivityType;
  fromStatus?: string | null;
  toStatus?: string | null;
  content?: string | null;
}

export async function registrarNoHistorico(
  repository: AppointmentActivityRepository,
  logger: Logger,
  registro: RegistroDeHistorico,
): Promise<void> {
  try {
    await repository.create({
      appointmentId: registro.appointmentId,
      userId: registro.userId,
      type: registro.type,
      fromStatus: registro.fromStatus ?? null,
      toStatus: registro.toStatus ?? null,
      content: registro.content ?? null,
    });
  } catch (err) {
    logger.warn(
      `Histórico da consulta ${registro.appointmentId} não registrado (${registro.type}): ${(err as Error)?.message}`,
    );
  }
}
