import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ScheduleBlock } from 'src/database/entities/schedule-block.entity';
import { ClinicRepository } from 'src/database/repositories/clinic.repository';
import { ScheduleBlockRepository } from 'src/database/repositories/schedule-block.repository';
import { Permission } from 'src/shared/permissions';
import { AccessControlService } from 'src/shared/services/access-control.service';
import {
  CreateScheduleBlockDto,
  FindScheduleBlocksDto,
  UpdateScheduleBlockDto,
} from './dto/schedule-block.dto';

const BLOQUEIOS_MAX_DIAS = 93;

const MSG_CLINICA_TODA =
  'Apenas administradores da conta podem criar, editar ou remover bloqueios de toda a clínica.';

@Injectable()
export class ScheduleBlocksService {
  constructor(
    private readonly blockRepository: ScheduleBlockRepository,
    private readonly clinicRepository: ClinicRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async findInRange(
    query: FindScheduleBlocksDto,
    userId: string,
  ): Promise<ScheduleBlock[]> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (!(from < to)) throw new BadRequestException('Intervalo inválido.');
    if (to.getTime() - from.getTime() > BLOQUEIOS_MAX_DIAS * 86_400_000) {
      throw new BadRequestException(
        `Consulte no máximo ${BLOQUEIOS_MAX_DIAS} dias por vez.`,
      );
    }
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const acessiveis =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    let doctorIds = acessiveis;
    if (query.doctorId) {
      if (!acessiveis.includes(query.doctorId)) {
        throw new ForbiddenException(
          'Médico não acessível para esta operação.',
        );
      }
      doctorIds = [query.doctorId];
    }
    return this.blockRepository.findInRange(ownerId, from, to, doctorIds);
  }

  async create(
    data: CreateScheduleBlockDto,
    userId: string,
    permissions: readonly Permission[],
  ): Promise<ScheduleBlock> {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const bloqueio = {
      ownerId,
      doctorId: data.doctorId ?? null,
      clinicId: data.clinicId ?? null,
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
      allDay: data.allDay ?? false,
      reason: data.reason?.trim() || null,
      createdById: userId,
    };
    await this.validar(bloqueio, userId, permissions);
    return this.blockRepository.create(bloqueio);
  }

  async update(
    id: string,
    data: UpdateScheduleBlockDto,
    userId: string,
    permissions: readonly Permission[],
  ): Promise<ScheduleBlock> {
    const atual = await this.getEditable(id, userId, permissions);
    const mudancas: Partial<ScheduleBlock> = {};
    if (data.doctorId !== undefined) mudancas.doctorId = data.doctorId ?? null;
    if (data.clinicId !== undefined) mudancas.clinicId = data.clinicId ?? null;
    if (data.startsAt !== undefined)
      mudancas.startsAt = new Date(data.startsAt);
    if (data.endsAt !== undefined) mudancas.endsAt = new Date(data.endsAt);
    if (data.allDay !== undefined) mudancas.allDay = data.allDay;
    if (data.reason !== undefined)
      mudancas.reason = data.reason?.trim() || null;
    await this.validar({ ...atual, ...mudancas }, userId, permissions);
    return (await this.blockRepository.update(id, mudancas))!;
  }

  async delete(
    id: string,
    userId: string,
    permissions: readonly Permission[],
  ): Promise<void> {
    await this.getEditable(id, userId, permissions);
    await this.blockRepository.softDelete(id);
  }

  private async getEditable(
    id: string,
    userId: string,
    permissions: readonly Permission[],
  ): Promise<ScheduleBlock> {
    const bloqueio = await this.blockRepository.findOne({ id });
    if (!bloqueio) throw new NotFoundException('Bloqueio não encontrado');
    await this.accessControlService.assertSameOwner(userId, bloqueio.ownerId);
    if (!bloqueio.doctorId) this.assertPodeClinicaToda(permissions);
    if (
      bloqueio.doctorId &&
      !(await this.accessControlService.canAccessDoctor(
        userId,
        bloqueio.doctorId,
      ))
    ) {
      throw new ForbiddenException('Médico não acessível para esta operação.');
    }
    return bloqueio;
  }

  private async validar(
    b: Pick<
      ScheduleBlock,
      'ownerId' | 'doctorId' | 'clinicId' | 'startsAt' | 'endsAt'
    >,
    userId: string,
    permissions: readonly Permission[],
  ): Promise<void> {
    if (!(b.startsAt < b.endsAt)) {
      throw new BadRequestException(
        'O início do bloqueio deve ser antes do fim.',
      );
    }
    if (!b.doctorId) this.assertPodeClinicaToda(permissions);
    if (
      b.doctorId &&
      !(await this.accessControlService.canAccessDoctor(userId, b.doctorId))
    ) {
      throw new ForbiddenException('Médico não acessível para esta operação.');
    }
    if (b.clinicId) {
      const clinica = await this.clinicRepository.findOne({ id: b.clinicId });
      if (!clinica || clinica.ownerId !== b.ownerId) {
        throw new BadRequestException('Clínica não encontrada.');
      }
    }
  }

  private assertPodeClinicaToda(permissions: readonly Permission[]): void {
    if (!permissions.includes(Permission.ADMINISTRACAO)) {
      throw new ForbiddenException(MSG_CLINICA_TODA);
    }
  }
}
