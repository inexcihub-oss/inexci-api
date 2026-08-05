import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateSurgeryRequestProcedureDto } from './dto/create-surgery-request-procedure.dto';
import { UpdateSurgeryRequestProcedureDto } from './dto/update-surgery-request-procedure.dto';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SurgeryRequestTussItemRepository } from 'src/database/repositories/surgery-request-tuss-item.repository';
import { AuthorizeProceduresDto } from './dto/authorize-procedures.dto';
import { SurgeryRequestAccessValidator } from 'src/shared/services/surgery-request-access.validator';
import { SurgeryRequestTussItem } from 'src/database/entities/surgery-request-tuss-item.entity';
import { OpmeItem } from 'src/database/entities/opme-item.entity';
import { executeInTransaction } from 'src/shared/utils/transaction.util';

@Injectable()
export class ProceduresService {
  private readonly logger = new Logger(ProceduresService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly tussItemRepository: SurgeryRequestTussItemRepository,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly accessValidator: SurgeryRequestAccessValidator,
  ) {}

  async create(data: CreateSurgeryRequestProcedureDto, userId: string) {
    // Fail-closed: garante posse da SC-pai antes de qualquer escrita (V1).
    await this.accessValidator.validateAndFetch(data.surgeryRequestId, userId);

    // Verifica duplicatas dentro do próprio payload enviado
    const incomingCodes = data.procedures.map((p) => p.tussCode);
    const uniqueIncoming = new Set(incomingCodes);
    if (uniqueIncoming.size !== incomingCodes.length) {
      throw new BadRequestException(
        'O payload contém procedimentos TUSS duplicados.',
      );
    }

    // Tudo ou nada: sem a transação, uma duplicata no item N deixava os
    // anteriores gravados e devolvia 400 com o banco meio alterado. O laço é
    // sequencial de propósito — as queries compartilham a mesma conexão.
    return await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const tussRepo = manager.getRepository(SurgeryRequestTussItem);
        const itemsCreated: Array<{
          authorizedQuantity: number | null;
          id: string;
          tussCode: string;
          name: string;
          quantity: number;
        }> = [];

        for (const item of data.procedures) {
          // Verifica se já existe o mesmo tussCode para esta solicitação
          const existing = await tussRepo.findOne({
            where: {
              surgeryRequestId: data.surgeryRequestId,
              tussCode: item.tussCode,
            },
          });
          if (existing) {
            throw new BadRequestException(
              `O procedimento TUSS ${item.tussCode} já foi adicionado a esta solicitação.`,
            );
          }

          const newItem = await tussRepo.save(
            tussRepo.create({
              surgeryRequestId: data.surgeryRequestId,
              tussCode: item.tussCode,
              name: item.name,
              quantity: Number(item.quantity),
            }),
          );

          itemsCreated.push({
            authorizedQuantity: null,
            id: newItem.id,
            tussCode: newItem.tussCode,
            name: newItem.name,
            quantity: newItem.quantity,
          });
        }

        return itemsCreated;
      },
      { logger: this.logger, operationName: 'createSurgeryRequestProcedures' },
    );
  }

  async authorize(data: AuthorizeProceduresDto, userId: string) {
    // Fail-closed: garante posse da SC-pai antes de autorizar itens (V1).
    await this.accessValidator.validateAndFetch(data.surgeryRequestId, userId);

    // Tudo ou nada: um id estranho no meio da lista não pode deixar os itens
    // anteriores já autorizados.
    await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const tussRepo = manager.getRepository(SurgeryRequestTussItem);
        const opmeRepo = manager.getRepository(OpmeItem);

        // Os ids dos itens vem do cliente: sem conferir o vinculo com a SC ja
        // validada, era possivel zerar quantidades e trocar fornecedor de itens
        // de uma cirurgia de outra clinica.
        for (const item of data.surgeryRequestProcedures) {
          const existente = await tussRepo.findOne({
            where: {
              id: item.id,
              surgeryRequestId: data.surgeryRequestId,
            },
          });
          if (!existente) {
            throw new NotFoundException(
              `Item de procedimento ${item.id} não pertence a esta solicitação`,
            );
          }
          await tussRepo.update(item.id, {
            authorizedQuantity: item.authorizedQuantity,
          });
        }

        for (const item of data.opmeItems) {
          const existente = await opmeRepo.findOne({
            where: {
              id: item.id,
              surgeryRequestId: data.surgeryRequestId,
            },
          });
          if (!existente) {
            throw new NotFoundException(
              `Item OPME ${item.id} não pertence a esta solicitação`,
            );
          }
          await opmeRepo.update(item.id, {
            authorizedQuantity: item.authorizedQuantity,
            ...(item.selectedSupplierId !== undefined && {
              selectedSupplierId: item.selectedSupplierId,
            }),
          });
        }
      },
      { logger: this.logger, operationName: 'authorizeSurgeryRequestItems' },
    );

    return {};
  }

  async update(
    id: string,
    dto: UpdateSurgeryRequestProcedureDto,
    userId: string,
  ) {
    const item = await this.tussItemRepository.findOne({ id });

    if (!item) {
      throw new NotFoundException('Procedimento TUSS não encontrado');
    }
    // Fail-closed: posse via SC-pai do item (V1).
    await this.accessValidator.validateAndFetch(item.surgeryRequestId, userId);

    await this.tussItemRepository.update(id, { quantity: dto.quantity });

    return { ...item, quantity: dto.quantity };
  }

  async delete(id: string, userId: string) {
    const item = await this.tussItemRepository.findOne({ id });

    if (!item) {
      throw new NotFoundException('Procedimento TUSS não encontrado');
    }
    // Fail-closed: posse via SC-pai do item (V1).
    await this.accessValidator.validateAndFetch(item.surgeryRequestId, userId);

    await this.tussItemRepository.delete(id);

    return { message: 'Procedimento TUSS removido com sucesso' };
  }
}
