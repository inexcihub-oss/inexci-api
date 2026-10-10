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
import { withActiveSpan } from 'src/shared/observability/span.util';

const MS_PER_DAY = 86_400_000;
const PENDING_ALERT_DAYS = 5;

type RawTotalRow = { total: string | number } & Record<string, unknown>;

function withNumericTotal<T extends RawTotalRow>(
  row: T,
): Omit<T, 'total'> & { total: number } {
  return { ...row, total: parseInt(String(row.total), 10) };
}

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
    if (filters.hospitalId) w.hospitalId = filters.hospitalId;
    if (filters.healthPlanId) w.healthPlanId = filters.healthPlanId;
    if (filters.startDate && filters.endDate) {
      w.createdAt = Between(filters.startDate, filters.endDate);
    } else if (filters.startDate) {
      w.createdAt = MoreThanOrEqual(filters.startDate);
    } else if (filters.endDate) {
      w.createdAt = LessThanOrEqual(filters.endDate);
    }
    return w;
  }

  async dashboard(userId: string, filters?: ReportFilters) {
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);

    if (doctorIds.length === 0) {
      return {
        surgeryRequest: {
          total: 0,
          totalScheduled: 0,
          totalPerformed: 0,
          totalInvoicedCount: 0,
          totalInvoicedValue: 0,
          totalReceivedValue: 0,
          totalByHealthPlan: [],
          totalByStatus: [],
          totalByHospital: [],
        },
      };
    }

    const [counts, totalInvoiced, rawHealthPlan, rawStatus, rawHospital]: [
      { total: number; scheduled: number; performed: number; invoiced: number },
      { invoicedValue: number; receivedValue: number },
      RawTotalRow[],
      RawTotalRow[],
      RawTotalRow[],
    ] = await Promise.all([
      this.surgeryRequestRepository.countsByStatus(doctorIds, filters),
      this.surgeryRequestRepository.sumInvoiced({ doctorIds }),
      this.surgeryRequestRepository.totalByHealthPlan(doctorIds, filters),
      this.surgeryRequestRepository.totalByStatus(doctorIds, filters),
      this.surgeryRequestRepository.totalByHospital(doctorIds, filters),
    ]);

    const respTotal = counts.total;
    const respTotalScheduled = counts.scheduled;
    const respPerformed = counts.performed;
    const respInvoiced = counts.invoiced;

    const totalByHealthPlan = rawHealthPlan.map(withNumericTotal);
    const totalByStatus = rawStatus.map(withNumericTotal);
    const totalByHospital = rawHospital.map(withNumericTotal);

    return {
      surgeryRequest: {
        total: respTotal,
        totalScheduled: respTotalScheduled,
        totalPerformed: respPerformed,
        totalInvoicedCount: respInvoiced,
        totalInvoicedValue: totalInvoiced.invoicedValue,
        totalReceivedValue: totalInvoiced.receivedValue,
        totalByHealthPlan: totalByHealthPlan,
        totalByStatus: totalByStatus,
        totalByHospital: totalByHospital,
      },
    };
  }

  private async getWhereConditions(userId: string, filters?: ReportFilters) {
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);

    let where: FindOptionsWhere<SurgeryRequest> = {};

    if (doctorIds.length > 0) {
      where = { ...where, doctorId: In(doctorIds) };
    } else {
      where = { ...where, doctorId: In(['__none__']) };
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
      filters?.startDate || new Date(endDate.getTime() - days * MS_PER_DAY);

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
      averageDays: result?.averageDays || 0,
    };
  }

  async pendingNotifications(userId: string, filters?: ReportFilters) {
    const { where } = await this.getWhereConditions(userId, filters);

    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - PENDING_ALERT_DAYS);

    const pendingAnalysis = await this.surgeryRequestRepository.total({
      ...where,
      status: SurgeryRequestStatus.IN_ANALYSIS,
      updatedAt: LessThan(fiveDaysAgo),
    });

    const pendingClosed = await this.surgeryRequestRepository.total({
      ...where,
      status: SurgeryRequestStatus.IN_SCHEDULING,
      updatedAt: LessThan(fiveDaysAgo),
    });

    return {
      total: pendingAnalysis + pendingClosed,
      pendingAnalysis,
      pendingScheduling: pendingClosed,
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
      month: item.monthLabel,
      count: parseInt(item.count, 10),
    }));
  }

  async dashboardFull(
    userId: string,
    filters?: ReportFilters,
    days: number = 30,
    months: number = 6,
  ) {
    return withActiveSpan(
      'reports.dashboardFull',
      { 'user.id': userId },
      async () => {
        const [
          dashboard,
          temporalEvolution,
          monthlyEvolution,
          averageCompletionTime,
          pendingNotifications,
        ] = await Promise.all([
          this.dashboard(userId, filters),
          this.temporalEvolution(userId, days, filters),
          this.monthlyEvolution(userId, months, filters),
          this.averageCompletionTime(userId, filters),
          this.pendingNotifications(userId, filters),
        ]);

        return {
          ...dashboard,
          temporalEvolution,
          monthlyEvolution,
          averageCompletionTime,
          pendingNotifications,
        };
      },
    );
  }
}
