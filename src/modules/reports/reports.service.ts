import { Logger, Injectable } from '@nestjs/common';
import {
  FindOptionsWhere,
  Between,
  LessThan,
  In,
  MoreThanOrEqual,
  LessThanOrEqual,
} from 'typeorm';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { AccessControlService } from 'src/shared/services/access-control.service';

export interface ReportFilters {
  hospitalId?: string;
  healthPlanId?: string;
  startDate?: Date;
  endDate?: Date;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  constructor(
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  private applyFilters(
    where: FindOptionsWhere<SurgeryRequest>,
    filters?: ReportFilters,
  ): FindOptionsWhere<SurgeryRequest> {
    if (!filters) return where;
    const w = { ...where };
    if (filters.hospitalId) w.hospital_id = filters.hospitalId;
    if (filters.healthPlanId) w.health_plan_id = filters.healthPlanId;
    if (filters.startDate && filters.endDate) {
      w.created_at = Between(filters.startDate, filters.endDate);
    } else if (filters.startDate) {
      w.created_at = MoreThanOrEqual(filters.startDate);
    } else if (filters.endDate) {
      w.created_at = LessThanOrEqual(filters.endDate);
    }
    return w;
  }

  async dashboard(userId: string, filters?: ReportFilters) {
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

    const baseWhere: FindOptionsWhere<SurgeryRequest> = {
      doctor_id: In(doctorIds),
    };
    const where = this.applyFilters(baseWhere, filters);

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

    const [totalInvoiced, rawHealthPlan, rawStatus, rawHospital]: any[] =
      await Promise.all([
        this.surgeryRequestRepository.sumInvoiced({ doctorIds }),
        this.surgeryRequestRepository.totalByHealthPlan(doctorIds, filters),
        this.surgeryRequestRepository.totalByStatus(doctorIds, filters),
        this.surgeryRequestRepository.totalByHospital(doctorIds, filters),
      ]);

    let totalByHealthPlan = rawHealthPlan;
    let totalByStatus = rawStatus;
    let totalByHospital = rawHospital;

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

  private async getWhereConditions(userId: string, filters?: ReportFilters) {
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);

    let where: FindOptionsWhere<SurgeryRequest> = {};

    if (doctorIds.length > 0) {
      where = { ...where, doctor_id: In(doctorIds) };
    } else {
      where = { ...where, doctor_id: In(['__none__']) };
    }

    where = this.applyFilters(where, filters);

    return { where, doctorIds };
  }

  async temporalEvolution(
    userId: string,
    days: number = 30,
    filters?: ReportFilters,
  ) {
    const { where } = await this.getWhereConditions(userId, filters);

    const endDate = filters?.endDate || new Date();
    const startDate =
      filters?.startDate || new Date(endDate.getTime() - days * 86400000);

    const results = await this.surgeryRequestRepository.getTemporalEvolution(
      where,
      startDate,
      endDate,
    );

    return results;
  }

  async averageCompletionTime(userId: string, filters?: ReportFilters) {
    const { where } = await this.getWhereConditions(userId, filters);

    const result =
      await this.surgeryRequestRepository.getAverageCompletionTime(where);

    return {
      average_days: result?.average_days || 0,
    };
  }

  async pendingNotifications(userId: string, filters?: ReportFilters) {
    const { where } = await this.getWhereConditions(userId, filters);

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

  async monthlyEvolution(
    userId: string,
    months: number = 6,
    filters?: ReportFilters,
  ) {
    const { where } = await this.getWhereConditions(userId, filters);

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
