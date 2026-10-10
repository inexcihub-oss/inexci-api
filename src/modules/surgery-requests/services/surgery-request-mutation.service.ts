import { DataSource, EntityManager } from 'typeorm';
import { executeInTransaction } from 'src/shared/utils/transaction.util';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AccessControlService } from 'src/shared/services/access-control.service';
import { DoctorResolutionService } from 'src/shared/services/doctor-resolution.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { HospitalRepository } from 'src/database/repositories/hospital.repository';
import { HealthPlanRepository } from 'src/database/repositories/health-plan.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SurgeryRequestTussItemRepository } from 'src/database/repositories/surgery-request-tuss-item.repository';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { HealthPlan } from 'src/database/entities/health-plan.entity';
import { Hospital } from 'src/database/entities/hospital.entity';
import { Patient } from 'src/database/entities/patient.entity';
import { Procedure } from 'src/database/entities/procedure.entity';
import {
  SurgeryRequestActivity,
  ActivityType,
} from 'src/database/entities/surgery-request-activity.entity';
import { CreateSurgeryRequestSimpleDto } from '../dto/create-surgery-request-simple.dto';
import { UpdateSurgeryRequestDto } from '../dto/update-surgery-request.dto';
import { UpdateSurgeryRequestBasicDto } from '../dto/update-surgery-request-basic.dto';
import { SurgeryRequestRealtimeService } from '../realtime/surgery-request-realtime.service';

export interface SurgeryRequestReferences {
  patientId?: string | null;
  hospitalId?: string | null;
  healthPlanId?: string | null;
  procedureId?: string | null;
}

const REFERENCE_CHECKS: Array<{
  key: keyof SurgeryRequestReferences;
  entity: new () => { id: string; ownerId: string };
  notFound: string;
}> = [
  { key: 'patientId', entity: Patient, notFound: 'Paciente não encontrado' },
  { key: 'hospitalId', entity: Hospital, notFound: 'Hospital não encontrado' },
  {
    key: 'healthPlanId',
    entity: HealthPlan,
    notFound: 'Convênio não encontrado',
  },
  {
    key: 'procedureId',
    entity: Procedure,
    notFound: 'Procedimento não encontrado',
  },
];

@Injectable()
export class SurgeryRequestMutationService {
  private readonly logger = new Logger(SurgeryRequestMutationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly accessControlService: AccessControlService,
    private readonly doctorResolutionService: DoctorResolutionService,
    private readonly userRepository: UserRepository,
    private readonly patientRepository: PatientRepository,
    private readonly hospitalRepository: HospitalRepository,
    private readonly healthPlanRepository: HealthPlanRepository,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly realtimeService: SurgeryRequestRealtimeService,
    private readonly tussItemRepository: SurgeryRequestTussItemRepository,
  ) {}

  resolveDoctorId(
    userId: string,
    doctorIdFromPayload?: string,
  ): Promise<string> {
    return this.doctorResolutionService.resolveDoctorId(
      userId,
      doctorIdFromPayload,
    );
  }

  async assertBelongsToOwner(
    refs: SurgeryRequestReferences,
    ownerId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<void> {
    for (const check of REFERENCE_CHECKS) {
      const id = refs[check.key];
      if (!id) continue;
      const found = await manager.getRepository(check.entity).findOne({
        where: { id },
        select: ['id', 'ownerId'],
      });
      if (!found || found.ownerId !== ownerId) {
        throw new NotFoundException(check.notFound);
      }
    }
  }

  async createSurgeryRequest(
    data: CreateSurgeryRequestSimpleDto,
    userId: string,
    options: { manager?: EntityManager } = {},
  ): Promise<SurgeryRequest> {
    this.logger.log(
      `[createSurgeryRequest] Criando solicitação simplificada por usuário ${userId}`,
    );
    const doctorId = await this.resolveDoctorId(userId, data.doctorId);
    const ownerId = await this.accessControlService.getOwnerId(userId);

    const persist = async (manager: EntityManager) => {
      await this.assertBelongsToOwner(
        {
          patientId: data.patientId,
          hospitalId: data.hospitalId,
          healthPlanId: data.healthPlanId,
          procedureId: data.procedureId,
        },
        ownerId,
        manager,
      );

      const request = await manager.getRepository(SurgeryRequest).save({
        doctorId,
        ownerId,
        createdById: userId,
        patientId: data.patientId,
        hospitalId: data.hospitalId || null,
        status: SurgeryRequestStatus.PENDING,
        isIndication: false,
        healthPlanId: data.healthPlanId || null,
        healthPlanRegistration: data.healthPlanRegistration?.trim() || null,
        priority: data.priority,
        procedureId: data.procedureId || null,
        requiredDocuments: data.requiredDocuments?.length
          ? data.requiredDocuments
          : null,
        lastStatusChangedAt: new Date(),
      });

      await manager.getRepository(SurgeryRequestActivity).save({
        surgeryRequestId: request.id,
        userId,
        type: ActivityType.SYSTEM,
        content: 'Solicitação cirúrgica criada',
      });

      return request;
    };

    if (options.manager) return persist(options.manager);

    const newRequest = await executeInTransaction(this.dataSource, persist, {
      logger: this.logger,
      operationName: 'createSurgeryRequest',
    });
    await this.broadcastCreated(newRequest.id, userId);
    return newRequest;
  }

  broadcastCreated(surgeryRequestId: string, userId: string): Promise<void> {
    return this.realtimeService.broadcastChange(
      surgeryRequestId,
      'created',
      userId,
    );
  }

  async update(data: UpdateSurgeryRequestDto, userId: string) {
    const surgeryRequest = await this.findWithAccess(data.id, userId);

    let hospitalId: string | null = surgeryRequest.hospitalId;

    if (data.hospital === null) {
      hospitalId = null;
    } else if (data.hospital?.name) {
      const hospital = await this.findOrCreateHospitalByName(
        data.hospital,
        surgeryRequest.ownerId,
      );
      hospitalId = hospital.id;
    }

    let healthPlanId: string | null = surgeryRequest.healthPlanId;
    if (data.healthPlan === null) {
      healthPlanId = null;
    } else if (data.healthPlan?.name) {
      const healthPlan = await this.findOrCreateHealthPlanByName(
        data.healthPlan,
        surgeryRequest.ownerId,
      );
      healthPlanId = healthPlan.id;
    }

    await this.assertBelongsToOwner(
      { procedureId: data.procedureId },
      surgeryRequest.ownerId,
    );

    const { id: _id, hospital: _h, healthPlan: _hp, cid, ...validData } = data;
    const cidData: { cidCode?: string | null } = {};
    if (cid === null) {
      cidData.cidCode = null;
    } else if (cid?.code) {
      cidData.cidCode = cid.code;
    }

    await this.surgeryRequestRepository.update(data.id, {
      ...validData,
      hospitalId,
      healthPlanId,
      ...cidData,
    });

    const shouldSyncPatientInsurance =
      data.healthPlanRegistration !== undefined ||
      data.healthPlan !== undefined;
    if (shouldSyncPatientInsurance && surgeryRequest.patientId) {
      const registration =
        data.healthPlanRegistration !== undefined
          ? data.healthPlanRegistration?.trim() || null
          : surgeryRequest.healthPlanRegistration?.trim() || null;
      await this.syncPatientInsuranceFromSc({
        patientId: surgeryRequest.patientId,
        ownerId: surgeryRequest.ownerId,
        healthPlanId,
        healthPlanNumber: registration,
      });
    }

    await this.realtimeService.broadcastChange(data.id, 'updated', userId);
    return surgeryRequest;
  }

  private async syncPatientInsuranceFromSc(input: {
    patientId: string;
    ownerId: string;
    healthPlanId: string | null;
    healthPlanNumber: string | null;
  }): Promise<void> {
    if (!input.healthPlanId && !input.healthPlanNumber) return;

    const patient = await this.patientRepository.findOne({
      id: input.patientId,
      ownerId: input.ownerId,
    });
    if (!patient) return;

    const patch: Partial<Patient> = {};
    if (input.healthPlanId && patient.healthPlanId !== input.healthPlanId) {
      patch.healthPlanId = input.healthPlanId;
    }
    if (
      input.healthPlanNumber &&
      patient.healthPlanNumber !== input.healthPlanNumber
    ) {
      patch.healthPlanNumber = input.healthPlanNumber;
    }
    if (Object.keys(patch).length === 0) return;

    await this.patientRepository.update(patient.id, patch);
  }

  async updateBasic(data: UpdateSurgeryRequestBasicDto, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);
    if (!data.id) {
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    }

    const surgeryRequest = await this.findWithAccess(data.id, userId);

    await this.assertBelongsToOwner(
      { hospitalId: data.hospitalId, healthPlanId: data.healthPlanId },
      surgeryRequest.ownerId,
    );

    const updateData: Partial<SurgeryRequest> = {};
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.hospitalId !== undefined)
      updateData.hospitalId = data.hospitalId ?? null;
    if (data.healthPlanId !== undefined)
      updateData.healthPlanId = data.healthPlanId ?? null;
    if (data.doctorId !== undefined) {
      if (surgeryRequest.status !== SurgeryRequestStatus.PENDING) {
        throw new BadRequestException(
          'O médico só pode ser alterado enquanto a solicitação estiver pendente',
        );
      }
      const accessibleDoctorIds =
        await this.accessControlService.getAccessibleDoctorIds(userId);
      if (!accessibleDoctorIds.includes(data.doctorId)) {
        throw new NotFoundException('Médico não encontrado');
      }
      updateData.doctorId = data.doctorId;
    }

    await this.surgeryRequestRepository.update(data.id, updateData);

    await this.realtimeService.broadcastChange(data.id, 'updated', userId);
    return this.surgeryRequestRepository.findOneSimple({ id: data.id });
  }

  async setHasOpme(id: string, hasOpme: boolean, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);

    await this.findWithAccess(id, userId);

    await this.surgeryRequestRepository.update(id, { hasOpme });
    await this.realtimeService.broadcastChange(id, 'updated', userId);
    return this.surgeryRequestRepository.findOneSimple({ id });
  }

  async addTussItem(
    surgeryRequestId: string,
    data: { tussCode: string; name: string; quantity: number },
    userId: string,
  ) {
    await this.findWithAccess(surgeryRequestId, userId);
    return this.tussItemRepository.create({
      surgeryRequestId,
      tussCode: data.tussCode,
      name: data.name,
      quantity: data.quantity,
    });
  }

  async updateTussItem(
    tussItemId: string,
    data: { tussCode?: string; name?: string; quantity?: number },
    userId: string,
  ) {
    const item = await this.tussItemRepository.findOne({ id: tussItemId });
    if (!item) throw new NotFoundException('Item TUSS não encontrado.');
    await this.findWithAccess(item.surgeryRequestId, userId);
    return this.tussItemRepository.update(tussItemId, data);
  }

  async removeTussItem(tussItemId: string, userId: string) {
    const item = await this.tussItemRepository.findOne({ id: tussItemId });
    if (!item) throw new NotFoundException('Item TUSS não encontrado.');
    await this.findWithAccess(item.surgeryRequestId, userId);
    return this.tussItemRepository.deleteById(tussItemId);
  }

  private async findWithAccess(
    id: string,
    userId: string,
  ): Promise<SurgeryRequest> {
    const where = await this.accessControlService.buildSurgeryAccessWhere(
      { id },
      userId,
    );
    const surgeryRequest =
      await this.surgeryRequestRepository.findOneSimple(where);
    if (!surgeryRequest)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    return surgeryRequest;
  }

  private async findOrCreateHealthPlanByName(
    data: { name: string; email?: string; phone?: string },
    ownerId: string,
  ): Promise<HealthPlan> {
    const existing = await this.healthPlanRepository.findOne({
      name: data.name,
      ownerId,
    });
    if (existing) return existing;
    return this.healthPlanRepository.create({
      name: data.name,
      email: data.email,
      phone: data.phone,
      ownerId,
    });
  }

  private async findOrCreateHospitalByName(
    data: { name: string; email?: string },
    ownerId: string,
  ): Promise<Hospital> {
    const existing = await this.hospitalRepository.findOne({
      name: data.name,
      ownerId,
    });
    if (existing) return existing;
    return this.hospitalRepository.create({
      name: data.name,
      email: data.email,
      ownerId,
    });
  }
}
