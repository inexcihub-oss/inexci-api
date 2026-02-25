import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateSurgeryRequestProcedureDto } from './dto/create-surgery-request-procedure.dto';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SurgeryRequestTussItemRepository } from 'src/database/repositories/surgery-request-tuss-item.repository';
import { AuthorizeProceduresDto } from './dto/authorize-procedures.dto';
import { OpmeItemRepository } from 'src/database/repositories/opme-item.repository';
import { StatusUpdateRepository } from 'src/database/repositories/status-update.repository';

@Injectable()
export class ProceduresService {
  constructor(
    private readonly opmeItemRepository: OpmeItemRepository,
    private readonly tussItemRepository: SurgeryRequestTussItemRepository,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly statusUpdateRepository: StatusUpdateRepository,
  ) {}

  async create(data: CreateSurgeryRequestProcedureDto) {
    // Verifica duplicatas dentro do próprio payload enviado
    const incomingCodes = data.procedures.map((p) => p.tuss_code);
    const uniqueIncoming = new Set(incomingCodes);
    if (uniqueIncoming.size !== incomingCodes.length) {
      throw new BadRequestException(
        'O payload contém procedimentos TUSS duplicados.',
      );
    }

    const itemsCreated = await Promise.all(
      data.procedures.map(async (item) => {
        // Verifica se já existe o mesmo tuss_code para esta solicitação
        const existing = await this.tussItemRepository.findOne({
          surgery_request_id: data.surgery_request_id,
          tuss_code: item.tuss_code,
        });
        if (existing) {
          throw new BadRequestException(
            `O procedimento TUSS ${item.tuss_code} já foi adicionado a esta solicitação.`,
          );
        }

        const newItem = await this.tussItemRepository.create({
          surgery_request_id: data.surgery_request_id,
          tuss_code: item.tuss_code,
          name: item.name,
          quantity: Number(item.quantity),
        });
        return {
          authorized_quantity: null,
          id: newItem.id,
          tuss_code: newItem.tuss_code,
          name: newItem.name,
          quantity: newItem.quantity,
        };
      }),
    );

    return itemsCreated;
  }

  async authorize(data: AuthorizeProceduresDto) {
    await this.surgeryRequestRepository.findOne({
      id: data.surgery_request_id,
    });

    await Promise.all(
      data.surgery_request_procedures.map((item) =>
        this.tussItemRepository.update(item.id, {
          authorized_quantity: item.authorized_quantity,
        }),
      ),
    );

    await Promise.all(
      data.opme_items.map((item) =>
        this.opmeItemRepository.update(item.id, {
          authorized_quantity: item.authorized_quantity,
        }),
      ),
    );

    return {};
  }

  async delete(id: string) {
    const item = await this.tussItemRepository.findOne({ id });

    if (!item) {
      throw new BadRequestException('Procedimento TUSS não encontrado');
    }

    await this.tussItemRepository.delete(id);

    return { message: 'Procedimento TUSS removido com sucesso' };
  }
}
