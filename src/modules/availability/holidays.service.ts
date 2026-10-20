import { Injectable, NotFoundException } from '@nestjs/common';
import { Holiday } from 'src/database/entities/holiday.entity';
import { HolidayRepository } from 'src/database/repositories/holiday.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { CreateHolidayDto, UpdateHolidayDto } from './dto/holiday.dto';

@Injectable()
export class HolidaysService {
  constructor(
    private readonly holidayRepository: HolidayRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async findMany(userId: string, year?: number): Promise<Holiday[]> {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const todos = await this.holidayRepository.findByOwner(ownerId);
    if (!year) return todos;
    return todos.filter((h) => h.recurring || h.date.startsWith(`${year}-`));
  }

  async create(data: CreateHolidayDto, userId: string): Promise<Holiday> {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    return this.holidayRepository.create({
      ownerId,
      name: data.name.trim(),
      date: data.date.slice(0, 10),
      recurring: data.recurring ?? false,
      blocksAgenda: data.blocksAgenda ?? true,
    });
  }

  async update(
    id: string,
    data: UpdateHolidayDto,
    userId: string,
  ): Promise<Holiday> {
    await this.getOwned(id, userId);
    const mudancas: Partial<Holiday> = {};
    if (data.name !== undefined) mudancas.name = data.name.trim();
    if (data.date !== undefined) mudancas.date = data.date.slice(0, 10);
    if (data.recurring !== undefined) mudancas.recurring = data.recurring;
    if (data.blocksAgenda !== undefined)
      mudancas.blocksAgenda = data.blocksAgenda;
    return (await this.holidayRepository.update(id, mudancas))!;
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.getOwned(id, userId);
    await this.holidayRepository.softDelete(id);
  }

  private async getOwned(id: string, userId: string): Promise<Holiday> {
    const feriado = await this.holidayRepository.findOne({ id });
    if (!feriado) throw new NotFoundException('Feriado não encontrado');
    await this.accessControlService.assertSameOwner(userId, feriado.ownerId);
    return feriado;
  }
}
