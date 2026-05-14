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

    const baseWhere: FindOptionsWhere<SurgeryRequest> = {
      doctorId: In(doctorIds),
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

    totalByHealthPlan = totalByHealthPlan.map((item: any) => {
      item.total = parseInt(item.total);
      return item;
    });

    totalByStatus = totalByStatus.map((item: any) => {
      item.total = parseInt(item.total);
      return item;
    });

    totalByHospital = totalByHospital.map((item: any) => {
      item.total = parseInt(item.total);
      return item;
    });

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
      averageDays: result?.averageDays || 0,
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
      updatedAt: LessThan(fiveDaysAgo),
    });

    // Status CLOSED representa o fechamento manual (era inReanalysis no sistema legado)
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
}
