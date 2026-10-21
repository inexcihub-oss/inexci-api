import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FinancialAccount } from 'src/database/entities/financial-account.entity';
import { CashSessionRepository } from 'src/database/repositories/cash-session.repository';
import { FinancialAccountRepository } from 'src/database/repositories/financial-account.repository';
import {
  CreateFinancialAccountDto,
  FinancialAccountDto,
  UpdateFinancialAccountDto,
} from '../dto/financial-account.dto';

export const CONTA_NAO_ENCONTRADA = 'Conta financeira não encontrada';
export const CONTA_INATIVA = 'A conta financeira está inativa';
export const TIPO_COM_CAIXA_ABERTO =
  'Feche o caixa aberto nesta conta antes de mudar o tipo dela';

function notasOuNulo(notes: string | null | undefined): string | null {
  return notes ? notes : null;
}

@Injectable()
export class FinancialAccountsService {
  constructor(
    private readonly accountRepository: FinancialAccountRepository,
    private readonly cashSessionRepository: CashSessionRepository,
  ) {}

  async list(
    ownerId: string,
    includeInactive = false,
  ): Promise<FinancialAccountDto[]> {
    const contas = await this.accountRepository.findByOwner(ownerId, {
      includeInactive,
    });
    return contas.map((conta) => this.toDto(conta));
  }

  async create(
    ownerId: string,
    userId: string,
    dto: CreateFinancialAccountDto,
  ): Promise<FinancialAccountDto> {
    const conta = await this.accountRepository.create({
      ownerId,
      createdById: userId,
      name: dto.name,
      type: dto.type,
      notes: notasOuNulo(dto.notes),
      active: true,
    });
    return this.toDto(conta);
  }

  async update(
    ownerId: string,
    userId: string,
    id: string,
    dto: UpdateFinancialAccountDto,
  ): Promise<FinancialAccountDto> {
    const conta = await this.findOwnedOrFail(ownerId, id);
    if (
      dto.type !== undefined &&
      dto.type !== conta.type &&
      (await this.cashSessionRepository.hasOpenForAccount(conta.id, ownerId))
    ) {
      throw new BadRequestException(TIPO_COM_CAIXA_ABERTO);
    }
    if (dto.name !== undefined) conta.name = dto.name;
    if (dto.type !== undefined) conta.type = dto.type;
    if (dto.notes !== undefined) conta.notes = notasOuNulo(dto.notes);
    conta.updatedById = userId;
    return this.toDto(await this.accountRepository.save(conta));
  }

  async setStatus(
    ownerId: string,
    userId: string,
    id: string,
    active: boolean,
  ): Promise<FinancialAccountDto> {
    const conta = await this.findOwnedOrFail(ownerId, id);
    conta.active = active;
    conta.updatedById = userId;
    return this.toDto(await this.accountRepository.save(conta));
  }

  async findOwnedOrFail(
    ownerId: string,
    id: string,
  ): Promise<FinancialAccount> {
    const conta = await this.accountRepository.findOwned(id, ownerId);
    if (!conta) throw new NotFoundException(CONTA_NAO_ENCONTRADA);
    return conta;
  }

  async findActiveOwnedOrFail(
    ownerId: string,
    id: string,
  ): Promise<FinancialAccount> {
    const conta = await this.findOwnedOrFail(ownerId, id);
    if (!conta.active) throw new BadRequestException(CONTA_INATIVA);
    return conta;
  }

  toDto(conta: FinancialAccount): FinancialAccountDto {
    return {
      id: conta.id,
      name: conta.name,
      type: conta.type,
      active: conta.active,
      notes: conta.notes ?? null,
      createdAt: conta.createdAt,
    };
  }
}
