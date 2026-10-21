import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  FinancialEntryDirection,
  FinancialEntryKind,
} from 'src/database/entities/financial-entry.entity';
import { FinancialEntryRepository } from 'src/database/repositories/financial-entry.repository';
import { Permission } from 'src/shared/permissions';
import { TransferDto, TransferResultDto } from '../dto/cash-session.dto';
import { validarDataDoLancamento } from '../utils/data-do-lancamento';
import { ehPositivo, normalizarValor } from '../utils/dinheiro';
import { FinancialAccountsService } from './financial-accounts.service';

export const CONTAS_IGUAIS =
  'A conta de origem e a de destino precisam ser diferentes';
export const VALOR_DA_TRANSFERENCIA_INVALIDO =
  'O valor da transferência deve ser maior que zero';

@Injectable()
export class TransfersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly entryRepository: FinancialEntryRepository,
    private readonly accountsService: FinancialAccountsService,
  ) {}

  async transfer(
    ownerId: string,
    userId: string,
    dto: TransferDto,
    permissoes: readonly Permission[] = [],
  ): Promise<TransferResultDto> {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException(CONTAS_IGUAIS);
    }
    if (!ehPositivo(dto.amount)) {
      throw new BadRequestException(VALOR_DA_TRANSFERENCIA_INVALIDO);
    }
    const origem = await this.accountsService.findActiveOwnedOrFail(
      ownerId,
      dto.fromAccountId,
    );
    const destino = await this.accountsService.findActiveOwnedOrFail(
      ownerId,
      dto.toAccountId,
    );
    const valor = normalizarValor(dto.amount);
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    if (dto.occurredAt) validarDataDoLancamento(occurredAt, permissoes);
    const descricao =
      dto.description || `Transferência de ${origem.name} para ${destino.name}`;

    return this.dataSource.transaction(async (manager) => {
      const saida = await this.entryRepository.insert(
        {
          ownerId,
          accountId: origem.id,
          cashSessionId: null,
          direction: FinancialEntryDirection.OUT,
          kind: FinancialEntryKind.TRANSFER,
          amount: valor,
          occurredAt,
          description: descricao.slice(0, 255),
          createdById: userId,
        },
        manager,
      );
      const entrada = await this.entryRepository.insert(
        {
          ownerId,
          accountId: destino.id,
          cashSessionId: null,
          direction: FinancialEntryDirection.IN,
          kind: FinancialEntryKind.TRANSFER,
          amount: valor,
          occurredAt,
          description: descricao.slice(0, 255),
          counterpartEntryId: saida.id,
          createdById: userId,
        },
        manager,
      );
      await this.entryRepository.linkCounterpart(saida.id, entrada.id, manager);
      return { outEntryId: saida.id, inEntryId: entrada.id };
    });
  }
}
