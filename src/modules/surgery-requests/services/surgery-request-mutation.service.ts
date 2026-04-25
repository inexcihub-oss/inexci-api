import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { DataSource } from 'typeorm';
import { executeInTransaction } from 'src/shared/utils/transaction.util';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AccessControlService } from 'src/shared/services/access-control.service';
import { DoctorResolutionService } from 'src/shared/services/doctor-resolution.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { HospitalRepository } from 'src/database/repositories/hospital.repository';
import { HealthPlanRepository } from 'src/database/repositories/health-plan.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import {
  SurgeryRequest,
  SurgeryRequestPriority,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { HealthPlan } from 'src/database/entities/health-plan.entity';
import { Hospital } from 'src/database/entities/hospital.entity';
import { Patient } from 'src/database/entities/patient.entity';
import { Chat } from 'src/database/entities/chat.entity';
import { StatusUpdate } from 'src/database/entities/status-update.entity';
import { User, UserRole, UserStatus } from 'src/database/entities/user.entity';
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

    const result = await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const patientRepo = manager.getRepository(Patient);
        const healthPlanRepo = manager.getRepository(HealthPlan);
        const hospitalRepo = manager.getRepository(Hospital);
        const surgeryRequestRepo = manager.getRepository(SurgeryRequest);
        const chatRepo = manager.getRepository(Chat);
        const statusUpdateRepo = manager.getRepository(StatusUpdate);
        const userRepo = manager.getRepository(User);

        let patient = await patientRepo.findOne({
          where: { email: data.patient.email, doctor_id: doctorId },
        });
        if (!patient) {
          patient = await patientRepo.save({
            doctor_id: doctorId,
            name: data.patient.name,
            email: data.patient.email,
            phone: data.patient.phone,
          });
        }

        const healthPlan = await this.resolveHealthPlan(
          data.health_plan,
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

        let managerId: string | null = null;
        if (data.collaborator) {
          let collaborator = await userRepo.findOne({
            where: { email: data.collaborator.email },
          });
          if (!collaborator) {
            const tempPassword = crypto.randomBytes(16).toString('hex');
            const hashedPassword = await bcrypt.hash(tempPassword, 10);
            collaborator = await userRepo.save(
              userRepo.create({
                role: UserRole.COLLABORATOR,
                status: UserStatus.PENDING,
                name: data.collaborator.name,
                email: data.collaborator.email,
                phone: data.collaborator.phone,
                password: hashedPassword,
              }),
            );
          }
          managerId = collaborator.id;
        }

        const newRequest = await surgeryRequestRepo.save({
          doctor_id: doctorId,
          created_by_id: userId,
          manager_id: managerId,
          patient_id: patient.id,
          hospital_id: hospital?.id || null,
          status: SurgeryRequestStatus.PENDING,
          is_indication: data.is_indication,
          indication_name: data.indication_name,
          health_plan_id: healthPlan.id,
          priority: data.priority || SurgeryRequestPriority.MEDIUM,
          deadline: data.deadline || null,
          procedure_id:
            !data.is_indication && data.procedure_id ? data.procedure_id : null,
          last_status_changed_at: new Date(),
        });

        await chatRepo.save({
          surgery_request_id: newRequest.id,
          user_id: userId,
        });
        await statusUpdateRepo.save({
          surgery_request_id: newRequest.id,
          prev_status: SurgeryRequestStatus.PENDING,
          new_status: SurgeryRequestStatus.PENDING,
        });
        const activityRepo = manager.getRepository(SurgeryRequestActivity);
        await activityRepo.save({
          surgery_request_id: newRequest.id,
          user_id: userId,
          type: ActivityType.SYSTEM,
          content: 'Solicitação cirúrgica criada',
        });

        return { request: newRequest, patient };
      },
      { logger: this.logger, operationName: 'create' },
    );

    // Envia boas-vindas WhatsApp ao paciente (assíncrono — não bloqueia o fluxo)
    if (result.patient?.phone) {
      void this.whatsappService.sendPatientWelcome(
        result.patient.phone,
        result.patient.name,
      );
    }

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
    const doctorId = await this.resolveDoctorId(userId, data.doctor_id);

    const newRequest = await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const surgeryRequestRepo = manager.getRepository(SurgeryRequest);
        const chatRepo = manager.getRepository(Chat);
        const statusUpdateRepo = manager.getRepository(StatusUpdate);

        const request = await surgeryRequestRepo.save({
          doctor_id: doctorId,
          created_by_id: userId,
          manager_id: data.manager_id,
          patient_id: data.patient_id,
          hospital_id: data.hospital_id || null,
          status: SurgeryRequestStatus.PENDING,
          is_indication: false,
          health_plan_id: data.health_plan_id || null,
          priority: data.priority,
          procedure_id: data.procedure_id || null,
          required_documents: data.required_documents?.length
            ? data.required_documents
            : null,
          last_status_changed_at: new Date(),
        });

        await chatRepo.save({
          surgery_request_id: request.id,
          user_id: userId,
        });
        await statusUpdateRepo.save({
          surgery_request_id: request.id,
          prev_status: SurgeryRequestStatus.PENDING,
          new_status: SurgeryRequestStatus.PENDING,
        });
        const activityRepo = manager.getRepository(SurgeryRequestActivity);
        await activityRepo.save({
          surgery_request_id: request.id,
          user_id: userId,
          type: ActivityType.SYSTEM,
          content: 'Solicitação cirúrgica criada',
        });

        return request;
      },
      { logger: this.logger, operationName: 'createSurgeryRequest' },
    );

    this.logger.log(
      `[WhatsApp] createSurgeryRequest chamado — patient_id: ${data.patient_id}`,
    );
    if (data.patient_id) {
      const patient = await this.patientRepository.findOne({
        id: data.patient_id,
      });
      this.logger.log(
        `[WhatsApp] paciente encontrado: ${patient?.name} | phone: ${patient?.phone}`,
      );
      if (patient?.phone) {
        this.logger.log(
          `[WhatsApp] enviando boas-vindas para ${patient.phone}`,
        );
        void this.whatsappService.sendPatientWelcome(
          patient.phone,
          patient.name,
        );
      } else {
        this.logger.warn(
          `[WhatsApp] paciente sem telefone cadastrado — mensagem não enviada`,
        );
      }
    } else {
      this.logger.warn(
        `[WhatsApp] patient_id não informado — mensagem não enviada`,
      );
    }

    return newRequest;
  }

  async update(data: UpdateSurgeryRequestDto, userId: string) {
    const surgeryRequest = await this.findWithAccess(data.id, userId);

    const doctorId = surgeryRequest.doctor_id;
    let hospitalId: string | null = surgeryRequest.hospital_id;

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

    let healthPlanId: string | null = surgeryRequest.health_plan_id;
    if (data.health_plan === null) {
      healthPlanId = null;
    } else if (data.health_plan?.name) {
      const healthPlan = await this.resolveHealthPlan(
        data.health_plan,
        doctorId,
        this.healthPlanRepository,
      );
      healthPlanId = healthPlan.id;
    }

    const { id, hospital: _h, health_plan, cid, ...validData } = data;
    const cidData: { cid_id?: string | null } = {};
    if (cid === null) {
      cidData.cid_id = null;
    } else if (cid?.id) {
      cidData.cid_id = cid.id;
    }

    await this.surgeryRequestRepository.update(data.id, {
      ...validData,
      hospital_id: hospitalId,
      ...cidData,
      health_plan_id: healthPlanId,
    });

    return surgeryRequest;
  }

  async updateBasic(data: UpdateSurgeryRequestBasicDto, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);

    const surgeryRequest = await this.findWithAccess(data.id, userId);

    const updateData: Partial<SurgeryRequest> = {};
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.deadline !== undefined)
      updateData.deadline = data.deadline ? new Date(data.deadline) : null;
    if (data.manager_id !== undefined) updateData.manager_id = data.manager_id;

    await this.surgeryRequestRepository.update(data.id, updateData);
    return this.surgeryRequestRepository.findOneSimple({ id: data.id });
  }

  async setHasOpme(id: string, hasOpme: boolean, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException(ERROR_MESSAGES.USER_NOT_FOUND);

    const surgeryRequest = await this.findWithAccess(id, userId);

    await this.surgeryRequestRepository.update(id, { has_opme: hasOpme });
    return this.surgeryRequestRepository.findOneSimple({ id });
  }

  private async findWithAccess(
    id: string,
    userId: string,
  ): Promise<SurgeryRequest> {
    let where: FindOptionsWhere<SurgeryRequest> = { id };
    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    if (doctorIds.length > 0) {
      where = { ...where, doctor_id: In(doctorIds) };
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
        doctor_id: doctorId,
      };
      entity = repo.save
        ? await repo.save(payload)
        : await (repo as any).create(payload);
    }
    return entity;
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
        doctor_id: doctorId,
      };
      entity = repo.save
        ? await repo.save(payload)
        : await (repo as any).create(payload);
    }
    return entity;
  }
}
