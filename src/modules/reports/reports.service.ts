import { Injectable } from '@nestjs/common';
import { FindOptionsWhere } from 'typeorm';
import surgeryRequestStatusesCommon from 'src/common/surgery-request-statuses.common';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { UsersService } from '../users/users.service';
import { UserPvs } from 'src/common';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';

@Injectable()
export class ReportsService {
  constructor(
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly userService: UsersService,
  ) {}

  async dashboard(userId: number) {
    let where: FindOptionsWhere<SurgeryRequest> = {};
    let whereString = 'WHERE ';

    const user = await this.userService.findOne(userId, userId);

    if (user.profile === UserPvs.doctor) {
      where = { ...where, doctor_id: user.id };
      whereString += `doctor_id=${user.id}`;
    } else if (user.profile === UserPvs.collaborator) {
      where = { ...where, responsible_id: user.id };
      whereString += `responsible_id=${user.id}`;
    }

    const [respTotal, respTotalScheduled, respDone, respAuthorized] =
      await Promise.all([
        this.surgeryRequestRepository.total(where),
        this.surgeryRequestRepository.total({
          ...where,
          status: surgeryRequestStatusesCommon.scheduled.value,
        }),
        this.surgeryRequestRepository.total({
          ...where,
          status: surgeryRequestStatusesCommon.toInvoice.value,
        }),
        this.surgeryRequestRepository.total({
          ...where,
          status: surgeryRequestStatusesCommon.invoiced.value,
        }),
        this.surgeryRequestRepository.total({
          ...where,
          status: surgeryRequestStatusesCommon.awaitingAppointment.value,
        }),
      ]);

    let [
      totalInvoiced,
      totalByHealthPlan,
      totalByStatus,
      totalByHospital,
    ]: any = await Promise.all([
      this.surgeryRequestRepository.sumInvoiced(where),
      this.surgeryRequestRepository.totalByHealthPlan(whereString),
      this.surgeryRequestRepository.totalByStatus(whereString),
      this.surgeryRequestRepository.totalByHospital(whereString),
    ]);

    totalByHealthPlan = totalByHealthPlan.map((item) => {
      item.total = parseInt(item.total);
      return item;
    });

    totalByStatus = totalByStatus.map((item) => {
      item.total = parseInt(item.total);
      return item;
    });

    totalByHospital = totalByHospital.map((item) => {
      item.total = parseInt(item.total);
      return item;
    });

    return {
      surgery_request: {
        total: respTotal,
        total_authorized: respAuthorized,
        total_scheduled: respTotalScheduled,
        total_done: respDone,
        total_invoiced: totalInvoiced._sum.invoiced_value,
        total_received: totalInvoiced._sum.received_value,
        total_by_health_plan: totalByHealthPlan,
        total_by_status: totalByStatus,
        total_by_hospital: totalByHospital,
      },
    };
  }
}
