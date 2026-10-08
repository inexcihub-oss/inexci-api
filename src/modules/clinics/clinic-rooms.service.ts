import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClinicRoom } from 'src/database/entities/clinic-room.entity';
import { ClinicRepository } from 'src/database/repositories/clinic.repository';
import { ClinicRoomRepository } from 'src/database/repositories/clinic-room.repository';
import { violacaoDeUnicidade } from 'src/database/repositories/unique-violation.util';
import { AccessControlService } from 'src/shared/services/access-control.service';
import {
  CreateClinicRoomDto,
  UpdateClinicRoomDto,
} from './dto/clinic-room.dto';

/**
 * Índice único de nome por clínica (`AddUniqueClinicRoomName1755801000000`).
 * Literal aqui de propósito: o service não importa de `migrations/`.
 */
const UQ_NOME_DA_SALA = 'uq_clinic_rooms_clinic_name_active';

/**
 * Salas (consultórios) de uma clínica. Isolamento pela conta (`ownerId`), como
 * a própria clínica; id de outra conta responde 404, sem confirmar existência.
 */
@Injectable()
export class ClinicRoomsService {
  constructor(
    private readonly clinicRepository: ClinicRepository,
    private readonly roomRepository: ClinicRoomRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  private async clinicaDaConta(clinicId: string, userId: string) {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const clinic = await this.clinicRepository.findOne({ id: clinicId });
    if (!clinic || clinic.ownerId !== ownerId) {
      throw new NotFoundException('Clínica não encontrada');
    }
    return { ownerId, clinic };
  }

  private async salaDaClinica(
    clinicId: string,
    roomId: string,
    ownerId: string,
  ): Promise<ClinicRoom> {
    const room = await this.roomRepository.findOne({ id: roomId });
    if (!room || room.ownerId !== ownerId || room.clinicId !== clinicId) {
      throw new NotFoundException('Sala não encontrada');
    }
    return room;
  }

  private async assertNomeLivre(
    ownerId: string,
    clinicId: string,
    name: string,
    excetoId?: string,
  ): Promise<void> {
    const salas = await this.roomRepository.findByClinic(ownerId, clinicId);
    const igual = salas.find(
      (s) =>
        s.id !== excetoId &&
        s.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (igual) {
      throw new ConflictException(
        `Já existe uma sala chamada "${igual.name}".`,
      );
    }
  }

  /**
   * O `assertNomeLivre` é check-then-insert: dois cadastros simultâneos passam
   * pela checagem antes de qualquer um gravar, e o índice único barra o
   * segundo. Traduz essa violação na mesma 409 amigável, em vez de um 500.
   */
  private async gravandoNome<T>(name: string, gravar: () => Promise<T>) {
    try {
      return await gravar();
    } catch (erro) {
      const violacao = violacaoDeUnicidade(erro);
      if (violacao && violacao.constraint === UQ_NOME_DA_SALA) {
        throw new ConflictException(`Já existe uma sala chamada "${name}".`);
      }
      throw erro;
    }
  }

  async list(clinicId: string, userId: string): Promise<ClinicRoom[]> {
    const { ownerId } = await this.clinicaDaConta(clinicId, userId);
    return this.roomRepository.findByClinic(ownerId, clinicId);
  }

  async create(
    clinicId: string,
    data: CreateClinicRoomDto,
    userId: string,
  ): Promise<ClinicRoom> {
    const { ownerId } = await this.clinicaDaConta(clinicId, userId);
    const name = data.name.trim();
    await this.assertNomeLivre(ownerId, clinicId, name);
    return this.gravandoNome(name, () =>
      this.roomRepository.create({
        ownerId,
        clinicId,
        name,
        active: true,
      }),
    );
  }

  async update(
    clinicId: string,
    roomId: string,
    data: UpdateClinicRoomDto,
    userId: string,
  ): Promise<ClinicRoom> {
    const { ownerId } = await this.clinicaDaConta(clinicId, userId);
    await this.salaDaClinica(clinicId, roomId, ownerId);

    const updateData: Partial<ClinicRoom> = {};
    if (data.name !== undefined) {
      updateData.name = data.name.trim();
      await this.assertNomeLivre(ownerId, clinicId, updateData.name, roomId);
    }
    if (data.active !== undefined) updateData.active = data.active;
    return (await this.gravandoNome(updateData.name ?? '', () =>
      this.roomRepository.update(roomId, updateData),
    ))!;
  }

  /** Soft delete: consultas antigas continuam apontando para a sala. */
  async delete(
    clinicId: string,
    roomId: string,
    userId: string,
  ): Promise<void> {
    const { ownerId } = await this.clinicaDaConta(clinicId, userId);
    await this.salaDaClinica(clinicId, roomId, ownerId);
    await this.roomRepository.delete(roomId);
  }
}
