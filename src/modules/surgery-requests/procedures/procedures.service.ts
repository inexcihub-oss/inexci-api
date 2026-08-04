import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateSurgeryRequestProcedureDto } from './dto/create-surgery-request-procedure.dto';
import { UpdateSurgeryRequestProcedureDto } from './dto/update-surgery-request-procedure.dto';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SurgeryRequestTussItemRepository } from 'src/database/repositories/surgery-request-tuss-item.repository';
import { AuthorizeProceduresDto } from './dto/authorize-procedures.dto';
import { OpmeItemRepository } from 'src/database/repositories/opme-item.repository';
import { SurgeryRequestAccessValidator } from 'src/shared/services/surgery-request-access.validator';

@Injectable()
export class ProceduresService {
  constructor(
    private readonly opmeItemRepository: OpmeItemRepository,
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

    const itemsCreated = await Promise.all(
      data.procedures.map(async (item) => {
        // Verifica se já existe o mesmo tussCode para esta solicitação
        const existing = await this.tussItemRepository.findOne({
          surgeryRequestId: data.surgeryRequestId,
          tussCode: item.tussCode,
        });
        if (existing) {
          throw new BadRequestException(
            `O procedimento TUSS ${item.tussCode} já foi adicionado a esta solicitação.`,
          );
        }

        const newItem = await this.tussItemRepository.create({
          surgeryRequestId: data.surgeryRequestId,
          tussCode: item.tussCode,
          name: item.name,
          quantity: Number(item.quantity),
        });
        return {
          authorizedQuantity: null,
          id: newItem.id,
          tussCode: newItem.tussCode,
          name: newItem.name,
          quantity: newItem.quantity,
        };
      }),
    );

    return itemsCreated;
  }

  async authorize(data: AuthorizeProceduresDto, userId: string) {
    // Fail-closed: garante posse da SC-pai antes de autorizar itens (V1).
    await this.accessValidator.validateAndFetch(data.surgeryRequestId, userId);

    // Os ids dos itens vem do cliente: sem conferir o vinculo com a SC ja
    // validada, era possivel zerar quantidades e trocar fornecedor de itens
    // de uma cirurgia de outra clinica.
    await Promise.all(
      data.surgeryRequestProcedures.map(async (item) => {
        const existente = await this.tussItemRepository.findOne({
          id: item.id,
          surgeryRequestId: data.surgeryRequestId,
        });
        if (!existente) {
          throw new NotFoundException(
            `Item de procedimento ${item.id} não pertence a esta solicitação`,
          );
        }
        return this.tussItemRepository.update(item.id, {
          authorizedQuantity: item.authorizedQuantity,
        });
      }),
    );

    await Promise.all(
      data.opmeItems.map(async (item) => {
        const existente = await this.opmeItemRepository.findOne({
          id: item.id,
          surgeryRequestId: data.surgeryRequestId,
        });
        if (!existente) {
          throw new NotFoundException(
            `Item OPME ${item.id} não pertence a esta solicitação`,
          );
        }
        return this.opmeItemRepository.update(item.id, {
          authorizedQuantity: item.authorizedQuantity,
          ...(item.selectedSupplierId !== undefined && {
            selectedSupplierId: item.selectedSupplierId,
          }),
        });
      }),
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
