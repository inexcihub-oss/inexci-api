import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ServicePrice } from 'src/database/entities/service-price.entity';
import {
  CriterioDePreco,
  ServicePriceRepository,
} from 'src/database/repositories/service-price.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import {
  CreateServicePriceDto,
  ResolvedServicePriceDto,
  ServicePriceDto,
  UpdateServicePriceDto,
} from '../dto/service-price.dto';
import { normalizarValor } from '../utils/dinheiro';

export const PRECO_NAO_ENCONTRADO = 'Preço não encontrado';
export const MEDICO_FORA_DA_CONTA = 'Médico não encontrado nesta conta';

@Injectable()
export class ServicePricesService {
  constructor(
    private readonly servicePriceRepository: ServicePriceRepository,
    private readonly userRepository: UserRepository,
  ) {}

  async list(ownerId: string): Promise<ServicePriceDto[]> {
    const precos = await this.servicePriceRepository.findByOwner(ownerId);
    return precos.map((preco) => this.toDto(preco));
  }

  async create(
    ownerId: string,
    userId: string,
    dto: CreateServicePriceDto,
  ): Promise<ServicePriceDto> {
    const doctorId = dto.doctorId ?? null;
    if (doctorId) await this.assertMedicoDaConta(ownerId, doctorId);

    const criado = await this.servicePriceRepository.create({
      ownerId,
      createdById: userId,
      doctorId,
      appointmentType: dto.appointmentType ?? null,
      description: dto.description,
      amount: normalizarValor(dto.amount),
      active: dto.active ?? true,
    });
    return this.findDto(ownerId, criado.id);
  }

  async update(
    ownerId: string,
    userId: string,
    id: string,
    dto: UpdateServicePriceDto,
  ): Promise<ServicePriceDto> {
    await this.findOwnedOrFail(ownerId, id);

    const mudancas: Partial<ServicePrice> = {};
    if (dto.doctorId !== undefined) {
      if (dto.doctorId) await this.assertMedicoDaConta(ownerId, dto.doctorId);
      mudancas.doctorId = dto.doctorId ?? null;
    }
    if (dto.appointmentType !== undefined) {
      mudancas.appointmentType = dto.appointmentType ?? null;
    }
    if (dto.description !== undefined) mudancas.description = dto.description;
    if (dto.amount !== undefined) mudancas.amount = normalizarValor(dto.amount);
    if (dto.active !== undefined) mudancas.active = dto.active;

    if (Object.keys(mudancas).length > 0) {
      mudancas.updatedById = userId;
      await this.servicePriceRepository.update(id, mudancas);
    }
    return this.findDto(ownerId, id);
  }

  async remove(ownerId: string, id: string): Promise<void> {
    await this.findOwnedOrFail(ownerId, id);
    await this.servicePriceRepository.hardDelete(id, ownerId);
  }

  async resolve(
    ownerId: string,
    criterio: CriterioDePreco,
  ): Promise<ResolvedServicePriceDto> {
    const preco = await this.servicePriceRepository.resolvePrice(
      ownerId,
      criterio,
    );
    return {
      amount: preco ? normalizarValor(preco.amount) : null,
      servicePriceId: preco?.id ?? null,
    };
  }

  private async findDto(ownerId: string, id: string): Promise<ServicePriceDto> {
    return this.toDto(await this.findOwnedOrFail(ownerId, id));
  }

  private async findOwnedOrFail(
    ownerId: string,
    id: string,
  ): Promise<ServicePrice> {
    const preco = await this.servicePriceRepository.findOwned(id, ownerId);
    if (!preco) throw new NotFoundException(PRECO_NAO_ENCONTRADO);
    return preco;
  }

  private async assertMedicoDaConta(
    ownerId: string,
    doctorId: string,
  ): Promise<void> {
    const medicos = await this.userRepository.findDoctorsByOwnerId(ownerId);
    if (!medicos.some((medico) => medico.id === doctorId)) {
      throw new BadRequestException(MEDICO_FORA_DA_CONTA);
    }
  }

  toDto(preco: ServicePrice): ServicePriceDto {
    return {
      id: preco.id,
      doctorId: preco.doctorId ?? null,
      doctor: preco.doctor
        ? { id: preco.doctor.id, name: preco.doctor.name }
        : null,
      appointmentType: preco.appointmentType ?? null,
      description: preco.description,
      amount: normalizarValor(preco.amount),
      active: preco.active,
    };
  }
}
