import { DataSource } from 'typeorm';
import { executeInTransaction } from 'src/shared/utils/transaction.util';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AccessControlService } from 'src/shared/services/access-control.service';
import { DoctorResolutionService } from 'src/shared/services/doctor-resolution.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { HospitalRepository } from 'src/database/repositories/hospital.repository';
import { HealthPlanRepository } from 'src/database/repositories/health-plan.repository';
import { ProcedureRepository } from 'src/database/repositories/procedure.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import {
  SurgeryRequest,
  SurgeryRequestPriority,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { HealthPlan } from 'src/database/entities/health-plan.entity';
import { Hospital } from 'src/database/entities/hospital.entity';
import { Patient } from 'src/database/entities/patient.entity';
import {
  SurgeryRequestActivity,
  ActivityType,
} from 'src/database/entities/surgery-request-activity.entity';
import { CreateSurgeryRequestDto } from '../dto/create-surgery-request.dto';
import { CreateSurgeryRequestSimpleDto } from '../dto/create-surgery-request-simple.dto';
import { UpdateSurgeryRequestDto } from '../dto/update-surgery-request.dto';
import { UpdateSurgeryRequestBasicDto } from '../dto/update-surgery-request-basic.dto';
import { FindOptionsWhere, In } from 'typeorm';

@Injectable()
export class SurgeryRequestMutationService {
  private readonly logger = new Logger(SurgeryRequestMutationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly accessControlService: AccessControlService,
    private readonly doctorResolutionService: DoctorResolutionService,
    private readonly whatsappService: WhatsappService,
    private readonly userRepository: UserRepository,
    private readonly patientRepository: PatientRepository,
    private readonly hospitalRepository: HospitalRepository,
    private readonly healthPlanRepository: HealthPlanRepository,
    private readonly procedureRepository: ProcedureRepository,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
  ) {}

  /**
   * Delega para DoctorResolutionService.
   * @deprecated Use doctorResolutionService.resolveDoctorId() diretamente.
   */
  resolveDoctorId(
    userId: string,
    doctorIdFromPayload?: string,
  ): Promise<string> {
    return this.doctorResolutionService.resolveDoctorId(
      userId,
      doctorIdFromPayload,
    );
  }

  async create(data: CreateSurgeryRequestDto, userId: string) {
    this.logger.log(
      `[create] Criando solicitação cirúrgica completa por usuário ${userId}`,
    );
    const doctorId = await this.resolveDoctorId(userId);
    const ownerId = await this.accessControlService.getOwnerId(userId);

    if (!data.isIndication && data.procedureId) {
      await this.assertProcedureBelongsToOwner(data.procedureId, ownerId);
    }

    const result = await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const patientRepo = manager.getRepository(Patient);
        const healthPlanRepo = manager.getRepository(HealthPlan);
        const hospitalRepo = manager.getRepository(Hospital);
        const surgeryRequestRepo = manager.getRepository(SurgeryRequest);

        let patient = await patientRepo.findOne({
          where: { email: data.patient.email, doctorId: doctorId },
        });
        if (!patient) {
          patient = await patientRepo.save({
            doctorId: doctorId,
            ownerId,
            name: data.patient.name,
            email: data.patient.email,
            phone: data.patient.phone,
          });
        }

        const healthPlan = await this.resolveHealthPlan(
          data.healthPlan,
          doctorId,
          {
            findOne: (w) => healthPlanRepo.findOne({ where: w }),
            save: (d) => healthPlanRepo.save(d),
          },
        );

        let hospital = null;
        if (data.hospital?.name) {
          hospital = await this.resolveHospital(data.hospital, doctorId, {
            findOne: (w) => hospitalRepo.findOne({ where: w }),
            save: (d) => hospitalRepo.save(d),
          });
        }

        const newRequest = await surgeryRequestRepo.save({
          doctorId: doctorId,
          ownerId,
          createdById: userId,
          patientId: patient.id,
          hospitalId: hospital?.id || null,
          status: SurgeryRequestStatus.PENDING,
          isIndication: data.isIndication,
          indicationName: data.indicationName,
          healthPlanId: healthPlan.id,
          priority: data.priority || SurgeryRequestPriority.MEDIUM,
          procedureId:
            !data.isIndication && data.procedureId ? data.procedureId : null,
          lastStatusChangedAt: new Date(),
        });

        const activityRepo = manager.getRepository(SurgeryRequestActivity);
        await activityRepo.save({
          surgeryRequestId: newRequest.id,
          userId: userId,
          type: ActivityType.SYSTEM,
          content: 'Solicitação cirúrgica criada',
        });

        return { request: newRequest, patient };
      },
      { logger: this.logger, operationName: 'create' },
    );

    this.logger.log(
      `[create] Solicitação ${result.request.id} criada com sucesso`,
    );
    return result.request;
  }

  async createSurgeryRequest(
    data: CreateSurgeryRequestSimpleDto,
    userId: string,
  ) {
    this.logger.log(
      `[createSurgeryRequest] Criando solicitação simplificada por usuário ${userId}`,
    );
    const doctorId = await this.resolveDoctorId(userId, data.doctorId);
    const ownerId = await this.accessControlService.getOwnerId(userId);

    if (data.procedureId) {
      await this.assertProcedureBelongsToOwner(data.procedureId, ownerId);
    }

    const newRequest = await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const surgeryRequestRepo = manager.getRepository(SurgeryRequest);

        const request = await surgeryRequestRepo.save({
          doctorId: doctorId,
          ownerId,
          createdById: userId,
          patientId: data.patientId,
          hospitalId: data.hospitalId || null,
          status: SurgeryRequestStatus.PENDING,
          isIndication: false,
          healthPlanId: data.healthPlanId || null,
          priority: data.priority,
          procedureId: data.procedureId || null,
          requiredDocuments: data.requiredDocuments?.length
            ? data.requiredDocuments
            : null,
          lastStatusChangedAt: new Date(),
        });

        const activityRepo = manager.getRepository(SurgeryRequestActivity);
        await activityRepo.save({
          surgeryRequestId: request.id,
          userId: userId,
          type: ActivityType.SYSTEM,
          content: 'Solicitação cirúrgica criada',
        });

        return request;
      },
      { logger: this.logger, operationName: 'createSurgeryRequest' },
    );

    return newRequest;
  }

  async update(data: UpdateSurgeryRequestDto, userId: string) {
    const surgeryRequest = await this.findWithAccess(data.id, userId);

    const doctorId = surgeryRequest.doctorId;
    let hospitalId: string | null = surgeryRequest.hospitalId;

    if (data.hospital === null) {
      hospitalId = null;
    } else if (data.hospital?.name) {
      const hospital = await this.resolveHospital(
        data.hospital,
        doctorId,
        this.hospitalRepository,
      );
      hospitalId = hospital.id;
    }

    let healthPlanId: string | null = surgeryRequest.healthPlanId;
    if (data.healthPlan === null) {
      healthPlanId = null;
    } else if (data.healthPlan?.name) {
      const healthPlan = await this.resolveHealthPlan(
        data.healthPlan,
        doctorId,
        this.healthPlanRepository,
      );
      healthPlanId = healthPlan.id;
    }

    const { id, hospital: _h, healthPlan, cid, ...validData } = data;
    // cid.id retorna o código CID diretamente (ex: "A00") — sem FK para tabela
    const cidData: { cidCode?: string | null } = {};
    if (cid === null) {
      cidData.cidCode = null;
    } else if (cid?.id) {
      cidData.cidCode = cid.id;
    }

    await this.surgeryRequestRepository.update(data.id, {
      ...validData,
      hospitalId: hospitalId,
      healthPlanId: healthPlanId,
      ...cidData,
    });

    return surgeryRequest;
  }

  async updateBasic(data: UpdateSurgeryRequestBasicDto, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
    if (!data.id) {
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    }

    await this.findWithAccess(data.id, userId);

    const updateData: Partial<SurgeryRequest> = {};
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.hospitalId !== undefined)
      updateData.hospitalId = data.hospitalId ?? null;
    if (data.healthPlanId !== undefined)
      updateData.healthPlanId = data.healthPlanId ?? null;

    await this.surgeryRequestRepository.update(data.id, updateData);

    return this.surgeryRequestRepository.findOneSimple({ id: data.id });
  }

  async setHasOpme(id: string, hasOpme: boolean, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);

    const _surgeryRequest = await this.findWithAccess(id, userId);

    await this.surgeryRequestRepository.update(id, { hasOpme: hasOpme });
    return this.surgeryRequestRepository.findOneSimple({ id });
  }

  private async assertProcedureBelongsToOwner(
    procedureId: string,
    ownerId: string,
  ): Promise<void> {
    const procedure = await this.procedureRepository.findOne({
      id: procedureId,
    });
    if (!procedure || procedure.ownerId !== ownerId) {
      throw new NotFoundException('Procedimento não encontrado');
    }
  }

  private async findWithAccess(
    id: string,
    userId: string,
  ): Promise<SurgeryRequest> {
    let where: FindOptionsWhere<SurgeryRequest> = { id };
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (doctorIds.length > 0) {
      where = { ...where, doctorId: In(doctorIds) };
    }
    const surgeryRequest =
      await this.surgeryRequestRepository.findOneSimple(where);
    if (!surgeryRequest)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    return surgeryRequest;
  }

  private async resolveHealthPlan(
    data: { name: string; email?: string; phone?: string },
    doctorId: string,
    repo: {
      findOne: (w: any) => Promise<HealthPlan | null>;
      save?: (d: any) => Promise<HealthPlan>;
      create?: (d: any) => Promise<HealthPlan>;
    },
  ): Promise<HealthPlan> {
    let entity = await repo.findOne({ name: data.name });
    if (!entity) {
      const payload = {
        name: data.name,
        email: data.email,
        phone: data.phone,
        doctorId: doctorId,
      };
      entity = repo.save
        ? await repo.save(payload)
        : await repo.create!(payload);
    }
    return entity!;
  }

  private async resolveHospital(
    data: { name: string; email?: string },
    doctorId: string,
    repo: {
      findOne: (w: any) => Promise<Hospital | null>;
      save?: (d: any) => Promise<Hospital>;
      create?: (d: any) => Promise<Hospital>;
    },
  ): Promise<Hospital> {
    let entity = await repo.findOne({ name: data.name });
    if (!entity) {
      const payload = {
        name: data.name,
        email: data.email,
        doctorId: doctorId,
      };
      entity = repo.save
        ? await repo.save(payload)
        : await repo.create!(payload);
    }
    return entity!;
  }
}
