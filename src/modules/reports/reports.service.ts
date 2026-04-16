import { Injectable } from '@nestjs/common';
import { FindOptionsWhere, Between, LessThan, In } from 'typeorm';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { AccessControlService } from 'src/shared/services/access-control.service';

@Injectable()
export class ReportsService {
  constructor(
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async dashboard(userId: string) {
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);

    if (doctorIds.length === 0) {
      return {
        surgery_request: {
          total: 0,
          total_scheduled: 0,
          total_performed: 0,
          total_invoiced_count: 0,
          total_invoiced_value: 0,
          total_received_value: 0,
          total_by_health_plan: [],
          total_by_status: [],
          total_by_hospital: [],
        },
      };
    }

    const where: FindOptionsWhere<SurgeryRequest> = {
      doctor_id: In(doctorIds),
    };

    const [respTotal, respTotalScheduled, respPerformed, respInvoiced] =
      await Promise.all([
        this.surgeryRequestRepository.total(where),
        this.surgeryRequestRepository.total({
          ...where,
          status: SurgeryRequestStatus.SCHEDULED,
        }),
        this.surgeryRequestRepository.total({
          ...where,
          status: SurgeryRequestStatus.PERFORMED,
        }),
        this.surgeryRequestRepository.total({
          ...where,
          status: SurgeryRequestStatus.INVOICED,
        }),
      ]);

    let [
      totalInvoiced,
      totalByHealthPlan,
      totalByStatus,
      totalByHospital,
    ]: any = await Promise.all([
      this.surgeryRequestRepository.sumInvoiced(where),
      this.surgeryRequestRepository.totalByHealthPlan(doctorIds),
      this.surgeryRequestRepository.totalByStatus(doctorIds),
      this.surgeryRequestRepository.totalByHospital(doctorIds),
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
        total_scheduled: respTotalScheduled,
        total_performed: respPerformed,
        total_invoiced_count: respInvoiced,
        total_invoiced_value: totalInvoiced._sum.invoiced_value,
        total_received_value: totalInvoiced._sum.received_value,
        total_by_health_plan: totalByHealthPlan,
        total_by_status: totalByStatus,
        total_by_hospital: totalByHospital,
      },
    };
  }

  private async getWhereConditions(userId: string) {
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);

    let where: FindOptionsWhere<SurgeryRequest> = {};

    if (doctorIds.length > 0) {
      where = { ...where, doctor_id: In(doctorIds) };
    } else {
      where = { ...where, doctor_id: In(['__none__']) };
    }

    return { where, doctorIds };
  }

  async temporalEvolution(userId: string, days: number = 30) {
    const { where } = await this.getWhereConditions(userId);

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const results = await this.surgeryRequestRepository.getTemporalEvolution(
      where,
      startDate,
      endDate,
    );

    return results;
  }

  async averageCompletionTime(userId: string) {
    const { where } = await this.getWhereConditions(userId);

    const result =
      await this.surgeryRequestRepository.getAverageCompletionTime(where);

    return {
      average_days: result?.average_days || 0,
    };
  }

  async pendingNotifications(userId: string) {
    const { where } = await this.getWhereConditions(userId);

    // Considerar como pendentes: solicitações em análise ou reanálise há mais de 5 dias
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const pendingAnalysis = await this.surgeryRequestRepository.total({
      ...where,
      status: SurgeryRequestStatus.IN_ANALYSIS,
      updated_at: LessThan(fiveDaysAgo),
    });

    // Status CLOSED representa o fechamento manual (era inReanalysis no sistema legado)
    const pendingClosed = await this.surgeryRequestRepository.total({
      ...where,
      status: SurgeryRequestStatus.IN_SCHEDULING,
      updated_at: LessThan(fiveDaysAgo),
    });

    return {
      total: pendingAnalysis + pendingClosed,
      pending_analysis: pendingAnalysis,
      pending_scheduling: pendingClosed,
    };
  }

  async monthlyEvolution(userId: string, months: number = 6) {
    const { where } = await this.getWhereConditions(userId);

    const results = await this.surgeryRequestRepository.getMonthlyEvolution(
      where,
      months,
    );

    return results.map((item) => ({
      month: item.month_label,
      count: parseInt(item.count, 10),
    }));
  }
}
