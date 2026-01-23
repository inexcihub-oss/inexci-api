import { BadRequestException, Injectable } from '@nestjs/common';
import { ProcedureRepository } from 'src/database/repositories/procedure.repository';
import { CreateSurgeryRequestProcedureDto } from './dto/create-surgery-request-procedure.dto';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SurgeryRequestProcedureRepository } from 'src/database/repositories/surgery-request-procedure.repository';
import { AuthorizeProceduresDto } from './dto/authorize-procedures.dto';
import { SurgeryRequestStatuses } from 'src/common';
import { OpmeItemRepository } from 'src/database/repositories/opme-item.repository';
import surgeryRequestStatusesCommon from 'src/common/surgery-request-statuses.common';
import { StatusUpdateRepository } from 'src/database/repositories/status-update.repository';

@Injectable()
export class ProceduresService {
  constructor(
    private readonly opmeItemRepository: OpmeItemRepository,
    private readonly procedureRepository: ProcedureRepository,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly surgeryRequestProcedureRepository: SurgeryRequestProcedureRepository,
    private readonly statusUpdateRepository: StatusUpdateRepository,
  ) {}

  async create(data: CreateSurgeryRequestProcedureDto) {
    const proceduresCreated = await Promise.all(
      data.procedures.map(async (item) => {
        const newProcedure =
          await this.surgeryRequestProcedureRepository.create({
            surgery_request_id: data.surgery_request_id,
            procedure_id: item.procedure_id,
            quantity: Number(item.quantity),
          });
        return {
          authorized_quantity: null,
          id: newProcedure.id,
          procedure: {
            id: newProcedure.procedure.id,
            name: newProcedure.procedure.name,
            tuss_code: newProcedure.procedure.tuss_code,
          },
          quantity: newProcedure.quantity,
        };
      }),
    );

    return proceduresCreated;
  }

  async authorize(data: AuthorizeProceduresDto) {
    const surgeryRequest = await this.surgeryRequestRepository.findOne({
      id: data.surgery_request_id,
    });

    await Promise.all(
      data.surgery_request_procedures.map((item) =>
        this.surgeryRequestProcedureRepository.update(item.id, {
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

    if (surgeryRequest.status === SurgeryRequestStatuses.inReanalysis.value) {
      await this.surgeryRequestRepository.update(data.surgery_request_id, {
        status: surgeryRequestStatusesCommon.inAnalysis.value,
      });

      await this.statusUpdateRepository.create({
        surgery_request_id: data.surgery_request_id,
        new_status: surgeryRequestStatusesCommon.inAnalysis.value,
        prev_status: surgeryRequest.status,
      });
    }

    return {};
  }
}
