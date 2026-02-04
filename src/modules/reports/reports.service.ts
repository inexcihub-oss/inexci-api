import { Injectable } from '@nestjs/common';
import { FindOptionsWhere, Between, LessThan } from 'typeorm';
import surgeryRequestStatusesCommon from 'src/common/surgery-request-statuses.common';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { UserRole } from 'src/database/entities/user.entity';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';

@Injectable()
export class ReportsService {
  constructor(
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly userRepository: UserRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
  ) {}

  private async getDoctorId(userId: string): Promise<string | null> {
    const user = await this.userRepository.findOne({ id: userId });

    if (user.role === UserRole.DOCTOR) {
      const doctorProfile =
        await this.doctorProfileRepository.findByUserId(userId);
      return doctorProfile?.id || null;
    }

    // TODO: Para colaboradores, obter via TeamMember
    return null;
  }

  async dashboard(userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    const doctorId = await this.getDoctorId(userId);

    let where: FindOptionsWhere<SurgeryRequest> = {};
    let whereString = 'WHERE ';

    if (user.role === UserRole.DOCTOR && doctorId) {
      where = { ...where, doctor_id: doctorId };
      whereString += `sr.doctor_id='${doctorId}'`;
    } else if (user.role === UserRole.COLLABORATOR) {
      where = { ...where, created_by_id: userId };
      whereString += `sr.created_by_id='${userId}'`;
    } else if (user.role === UserRole.ADMIN) {
      whereString += '1=1'; // Admin vê tudo
    }

    const [respTotal, respTotalScheduled, respPerformed, respInvoiced] =
      await Promise.all([
        this.surgeryRequestRepository.total(where),
        this.surgeryRequestRepository.total({
          ...where,
          status: surgeryRequestStatusesCommon.scheduled.value,
        }),
        this.surgeryRequestRepository.total({
          ...where,
          status: surgeryRequestStatusesCommon.performed.value,
        }),
        this.surgeryRequestRepository.total({
          ...where,
          status: surgeryRequestStatusesCommon.invoiced.value,
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
    const user = await this.userRepository.findOne({ id: userId });
    const doctorId = await this.getDoctorId(userId);

    let where: FindOptionsWhere<SurgeryRequest> = {};
    let whereString = 'WHERE 1=1';

    if (user.role === UserRole.DOCTOR && doctorId) {
      where = { ...where, doctor_id: doctorId };
      whereString += ` AND doctor_id='${doctorId}'`;
    } else if (user.role === UserRole.COLLABORATOR) {
      where = { ...where, created_by_id: userId };
      whereString += ` AND created_by_id='${userId}'`;
    }

    return { where, whereString };
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
      status: surgeryRequestStatusesCommon.inAnalysis.value,
      updated_at: LessThan(fiveDaysAgo),
    });

    const pendingReanalysis = await this.surgeryRequestRepository.total({
      ...where,
      status: surgeryRequestStatusesCommon.inReanalysis.value,
      updated_at: LessThan(fiveDaysAgo),
    });

    return {
      total: pendingAnalysis + pendingReanalysis,
      pending_analysis: pendingAnalysis,
      pending_reanalysis: pendingReanalysis,
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
