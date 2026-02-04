import { FindOptionsWhere, In, DataSource } from 'typeorm';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { DocumentTypes, SurgeryRequestStatuses } from 'src/common';
import { UsersService } from '../users/users.service';
import { FindManySurgeryRequestDto } from './dto/find-many.dto';
import { StorageService } from 'src/shared/storage/storage.service';
import { CreateSurgeryRequestDto } from './dto/create-surgery-request.dto';
import { CreateSurgeryRequestSimpleDto } from './dto/create-surgery-request-simple.dto';
import { UserRepository } from 'src/database/repositories/user.repository';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { HospitalRepository } from 'src/database/repositories/hospital.repository';
import { HealthPlanRepository } from 'src/database/repositories/health-plan.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SurgeryRequestQuotationRepository } from 'src/database/repositories/surgery-request-quotation.repository';
import {
  SurgeryRequest,
  SurgeryRequestPriority,
} from 'src/database/entities/surgery-request.entity';
import { Hospital } from 'src/database/entities/hospital.entity';
import { UpdateSurgeryRequestDto } from './dto/update-surgery-request.dto';
import { UpdateSurgeryRequestBasicDto } from './dto/update-surgery-request-basic.dto';
import { EmailService } from 'src/shared/email/email.service';
import surgeryRequestStatusesCommon, {
  StatusConfig,
} from 'src/common/surgery-request-statuses.common';
import { PendencyValidatorService } from './pendencies/pendency-validator.service';
import { SendSurgeryRequestDto } from './dto/send-surgery-request.dto';
import { StatusUpdateRepository } from 'src/database/repositories/status-update.repository';
import { CreateSurgeryDateOptions } from './dto/create-surgery-date-options.dto';
import { ScheduleSurgeryRequestDto } from './dto/schedule-surgery-request.dto';
import { ToInvoiceDto } from './dto/to-invoice.dto';
import { InvoiceDto } from './dto/invoice.dto';
import { DocumentsService } from './documents/documents.service';
import { ReceiveDto } from './dto/receive.dto';
import { DocumentsKeyService } from './documents-key/documents-key.service';
import { FindManyDocumentKeyDto } from './documents-key/dto/find-many-dto';
import { CreateContestSurgeryRequestDto } from './dto/create-contest-surgery-request.dto';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import dayjs from 'dayjs';
import { User, UserRole, UserStatus } from 'src/database/entities/user.entity';
import { Patient } from 'src/database/entities/patient.entity';
import { HealthPlan } from 'src/database/entities/health-plan.entity';
import { Chat } from 'src/database/entities/chat.entity';
import { StatusUpdate } from 'src/database/entities/status-update.entity';
import { SurgeryRequestProcedure } from 'src/database/entities/surgery-request-procedure.entity';

@Injectable()
export class SurgeryRequestsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
    private readonly pendencyValidatorService: PendencyValidatorService,
    private readonly userService: UsersService,
    private readonly storageService: StorageService,
    private readonly documentsService: DocumentsService,
    private readonly documentsKeyService: DocumentsKeyService,
    private readonly userRepository: UserRepository,
    private readonly patientRepository: PatientRepository,
    private readonly hospitalRepository: HospitalRepository,
    private readonly healthPlanRepository: HealthPlanRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly statusUpdateRepository: StatusUpdateRepository,
    private readonly surgeryRequestQuotationRepository: SurgeryRequestQuotationRepository,
  ) {}

  /**
   * Helper para obter o doctorId baseado no userId logado
   */
  private async getDoctorId(userId: string): Promise<string | null> {
    const user = await this.userRepository.findOne({ id: userId });

    if (user.role === UserRole.DOCTOR) {
      const doctorProfile =
        await this.doctorProfileRepository.findByUserId(userId);
      return doctorProfile?.id || null;
    }

    if (user.role === UserRole.COLLABORATOR) {
      // TODO: Obter doctor via TeamMember
      return null;
    }

    return null;
  }

  async create(data: CreateSurgeryRequestDto, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    const doctorId = await this.getDoctorId(userId);

    if (!doctorId) {
      throw new BadRequestException('Perfil de médico não encontrado');
    }

    return await this.dataSource.transaction(async (manager) => {
      const patientRepo = manager.getRepository(Patient);
      const healthPlanRepo = manager.getRepository(HealthPlan);
      const hospitalRepo = manager.getRepository(Hospital);
      const surgeryRequestRepo = manager.getRepository(SurgeryRequest);
      const chatRepo = manager.getRepository(Chat);
      const statusUpdateRepo = manager.getRepository(StatusUpdate);
      const surgeryRequestProcedureRepo = manager.getRepository(
        SurgeryRequestProcedure,
      );
      const userRepo = manager.getRepository(User);

      // Buscar ou criar paciente (entidade separada agora)
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

      // Buscar ou criar convênio
      let healthPlan = await healthPlanRepo.findOne({
        where: { name: data.health_plan.name },
      });
      if (!healthPlan) {
        healthPlan = await healthPlanRepo.save({
          name: data.health_plan.name,
          email: data.health_plan.email,
          phone: data.health_plan.phone,
          doctor_id: doctorId,
        });
      }

      // Buscar ou criar hospital
      let hospital = null;
      if (data.hospital?.name) {
        hospital = await hospitalRepo.findOne({
          where: { name: data.hospital.name },
        });
        if (!hospital) {
          hospital = await hospitalRepo.save({
            doctor_id: doctorId,
            name: data.hospital.name,
            email: data.hospital.email,
          });
        }
      }

      // Buscar ou criar colaborador/gestor
      let managerId: string | null = null;
      if (data.collaborator) {
        let collaborator = await userRepo.findOne({
          where: { email: data.collaborator.email },
        });
        if (!collaborator) {
          collaborator = await userRepo.save({
            role: UserRole.COLLABORATOR,
            status: data.collaborator.status,
            name: data.collaborator.name,
            email: data.collaborator.email,
            phone: data.collaborator.phone,
            password: data.collaborator.password, // Já vem hasheado do frontend
          });
        }
        managerId = collaborator.id;
      }

      const statusData = surgeryRequestStatusesCommon.pending;

      const newRequest = await surgeryRequestRepo.save({
        doctor_id: doctorId,
        created_by_id: userId,
        manager_id: managerId,
        patient_id: patient.id,
        hospital_id: hospital?.id || null,
        status: statusData.value,
        is_indication: data.is_indication,
        indication_name: data.indication_name,
        health_plan_id: healthPlan.id,
        priority: data.priority || SurgeryRequestPriority.MEDIUM,
        deadline: data.deadline || null,
      });

      // Adicionar procedimento se não for indicação
      if (!data.is_indication && data.procedure_id) {
        await surgeryRequestProcedureRepo.save({
          surgery_request_id: newRequest.id,
          procedure_id: data.procedure_id,
          quantity: 1,
        });
      }

      // Chat agora é com o usuário que criou (médico ou colaborador)
      await chatRepo.save({
        surgery_request_id: newRequest.id,
        user_id: userId,
      });

      await statusUpdateRepo.save({
        surgery_request_id: newRequest.id,
        prev_status: statusData.value,
        new_status: statusData.value,
      });

      return newRequest;
    });
  }

  async createSurgeryRequest(
    data: CreateSurgeryRequestSimpleDto,
    userId: string,
  ) {
    const doctorId = await this.getDoctorId(userId);

    if (!doctorId) {
      throw new BadRequestException('Perfil de médico não encontrado');
    }

    return await this.dataSource.transaction(async (manager) => {
      const surgeryRequestRepo = manager.getRepository(SurgeryRequest);
      const chatRepo = manager.getRepository(Chat);
      const statusUpdateRepo = manager.getRepository(StatusUpdate);
      const surgeryRequestProcedureRepo = manager.getRepository(
        SurgeryRequestProcedure,
      );

      const statusData = surgeryRequestStatusesCommon.pending;

      const newRequest = await surgeryRequestRepo.save({
        doctor_id: doctorId,
        created_by_id: userId,
        manager_id: data.manager_id,
        patient_id: data.patient_id,
        hospital_id: data.hospital_id || null,
        status: statusData.value,
        is_indication: false,
        indication_name: null,
        health_plan_id: data.health_plan_id || null,
        priority: data.priority,
        deadline: null,
      });

      // Adicionar procedimento
      await surgeryRequestProcedureRepo.save({
        surgery_request_id: newRequest.id,
        procedure_id: data.procedure_id,
        quantity: 1,
      });

      // Criar chat
      await chatRepo.save({
        surgery_request_id: newRequest.id,
        user_id: userId,
      });

      // Status inicial
      await statusUpdateRepo.save({
        surgery_request_id: newRequest.id,
        user_id: userId,
        prev_status: statusData.value,
        new_status: statusData.value,
      });

      return newRequest;
    });
  }

  async send(data: SendSurgeryRequestDto, userId: string) {
    const surgeryRequest = await this.surgeryRequestRepository.findOne({
      id: data.id,
    });

    // Valida pendências dinamicamente
    const validation = await this.pendencyValidatorService.validate(data.id);
    const hasPendingItems = validation.pendencies.some((p) => !p.isComplete);

    if (hasPendingItems)
      throw new BadRequestException('A solicitação ainda possui pendências');

    return await this.dataSource.transaction(async (manager) => {
      const surgeryRequestRepo = manager.getRepository(SurgeryRequest);
      const statusUpdateRepo = manager.getRepository(StatusUpdate);

      await Promise.all([
        surgeryRequestRepo.update(
          { id: data.id },
          { status: surgeryRequestStatusesCommon.sent.value },
        ),
        statusUpdateRepo.save({
          surgery_request_id: data.id,
          prev_status: surgeryRequestStatusesCommon.pending.value,
          new_status: surgeryRequestStatusesCommon.sent.value,
        }),
      ]);
    });
  }

  async cancel(data: SendSurgeryRequestDto, userId: string) {
    const surgeryRequest = await this.surgeryRequestRepository.findOne({
      id: data.id,
    });
    if (!surgeryRequest)
      throw new NotFoundException('Solicitação não encontrada');

    await this.surgeryRequestRepository.update(data.id, {
      status: SurgeryRequestStatuses.canceled.value,
    });

    await this.statusUpdateRepository.create({
      surgery_request_id: data.id,
      new_status: SurgeryRequestStatuses.canceled.value,
      prev_status: surgeryRequest.status,
    });

    return;
  }

  async schedule(data: ScheduleSurgeryRequestDto, userId: string) {
    const surgeryRequest = await this.surgeryRequestRepository.findOne({
      id: data.id,
    });
    if (!surgeryRequest)
      throw new NotFoundException('Solicitação não encontrada');

    return await this.dataSource.transaction(async (manager) => {
      const surgeryRequestRepo = manager.getRepository(SurgeryRequest);
      const statusUpdateRepo = manager.getRepository(StatusUpdate);

      await Promise.all([
        surgeryRequestRepo.update(
          { id: data.id },
          { status: surgeryRequestStatusesCommon.scheduled.value },
        ),
        statusUpdateRepo.save({
          surgery_request_id: data.id,
          prev_status: surgeryRequest.status,
          new_status: surgeryRequestStatusesCommon.scheduled.value,
        }),
      ]);
    });
  }

  async toInvoice(data: ToInvoiceDto, userId: string) {
    const surgeryRequest = await this.surgeryRequestRepository.findOne({
      id: data.id,
    });
    if (!surgeryRequest)
      throw new NotFoundException('Solicitação não encontrada');

    const statusData = SurgeryRequestStatuses.toInvoice;

    const updated = await this.surgeryRequestRepository.update(data.id, {
      status: statusData.value,
    });

    await this.statusUpdateRepository.create({
      surgery_request_id: data.id,
      new_status: statusData.value,
      prev_status: surgeryRequest.status,
    });

    return updated;
  }

  async receive(data: ReceiveDto, userId: string) {
    const surgeryRequest = await this.surgeryRequestRepository.findOne({
      id: data.surgery_request_id,
    });
    if (!surgeryRequest)
      throw new NotFoundException('Solicitação não encontrada');

    const statusData = SurgeryRequestStatuses.received;

    const updated = await this.surgeryRequestRepository.update(
      data.surgery_request_id,
      {
        received_value: Number(data.received_value),
        received_date: data.received_date,
        status: statusData.value,
      },
    );

    await this.statusUpdateRepository.create({
      surgery_request_id: data.surgery_request_id,
      new_status: statusData.value,
      prev_status: surgeryRequest.status,
    });

    return updated;
  }

  async invoice(data: InvoiceDto, userId: string, file: Express.Multer.File) {
    const surgeryRequest = await this.surgeryRequestRepository.findOne({
      id: data.surgery_request_id,
    });
    if (!surgeryRequest)
      throw new NotFoundException('Solicitação não encontrada');

    const respFile = await this.documentsService.create(
      {
        surgery_request_id: data.surgery_request_id,
        key: `document_${DocumentTypes.invoiceProtocol}`,
        name: 'Protocolo de faturamento',
      },
      userId,
      file,
    );

    const statusData = SurgeryRequestStatuses.invoiced;

    const updated = await this.surgeryRequestRepository.update(
      data.surgery_request_id,
      {
        status: statusData.value,
        invoiced_date: data.invoiced_date,
        invoiced_value: Number(data.invoiced_value),
      },
    );

    await this.statusUpdateRepository.create({
      surgery_request_id: data.surgery_request_id,
      new_status: statusData.value,
      prev_status: surgeryRequest.status,
    });

    return updated;
  }

  async createDateOptions(data: CreateSurgeryDateOptions, userId: string) {
    const surgeryRequest = await this.surgeryRequestRepository.findOne({
      id: data.id,
    });
    if (!surgeryRequest)
      throw new NotFoundException('Solicitação não encontrada');

    if (!surgeryRequest.opme_items.length || !surgeryRequest.procedures.length)
      throw new BadRequestException(
        'Para prosseguir com a solicitação, a lista OPME e os procedimentos devem ser informados',
      );

    this.emailService.send(
      surgeryRequest.patient.email,
      'Inexci - Escolha de data para sua cirurgia',
      `
        <p>Olá, <strong>${surgeryRequest.patient.name}</strong></p>
        <p>As opções de data para sua cirurgia foram adicionadas a plataforma. <a href='${process.env.DASHBOARD_URL}/surgeryRequests/${surgeryRequest.id}'>Clique aqui</a> para acessar a solicitação e escolher a melhor.</p>
      `,
    );

    const updated = await this.surgeryRequestRepository.update(data.id, {
      date_options: data.dates,
      status: SurgeryRequestStatuses.awaitingAppointment.value,
    });

    await this.statusUpdateRepository.create({
      surgery_request_id: data.id,
      new_status: SurgeryRequestStatuses.awaitingAppointment.value,
      prev_status: surgeryRequest.status,
    });

    return updated;
  }

  async findAll(query: FindManySurgeryRequestDto, userId: string) {
    let where: FindOptionsWhere<SurgeryRequest> = {};

    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    if (query.status) {
      where = { ...where, status: In(query.status) };
    }

    // Na nova arquitetura, apenas admin, doctor e collaborator fazem login
    if (user.role === UserRole.ADMIN) {
      // Admin vê todas as solicitações
    } else if (user.role === UserRole.DOCTOR) {
      const doctorId = await this.getDoctorId(userId);
      if (doctorId) {
        where = { ...where, doctor_id: doctorId };
      }
    } else if (user.role === UserRole.COLLABORATOR) {
      where = { ...where, created_by_id: userId };
    }

    const [total, records] = await Promise.all([
      this.surgeryRequestRepository.total(where),
      this.surgeryRequestRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }

  async findOne(id: string, userId: string) {
    let where: FindOptionsWhere<SurgeryRequest> = { id };
    let whereChat: any = {};
    let whereQuotation: any = {};

    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    // Na nova arquitetura, apenas admin, doctor e collaborator fazem login
    if (user.role === UserRole.ADMIN) {
      // Admin pode ver qualquer solicitação
    } else if (user.role === UserRole.DOCTOR) {
      const doctorId = await this.getDoctorId(userId);
      if (doctorId) {
        where = { ...where, doctor_id: doctorId };
      }
    } else if (user.role === UserRole.COLLABORATOR) {
      where = { ...where, created_by_id: userId };
    }

    let surgeryRequest = await this.surgeryRequestRepository.findOne(
      where,
      whereChat,
      whereQuotation,
    );
    if (!surgeryRequest)
      throw new NotFoundException('Surgery request not found');

    return surgeryRequest;
  }

  async findOneSimple(id: string, userId: string) {
    let where: FindOptionsWhere<SurgeryRequest> = { id };

    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    if (user.role === UserRole.ADMIN) {
      // Admin pode ver qualquer solicitação
    } else if (user.role === UserRole.DOCTOR) {
      const doctorId = await this.getDoctorId(userId);
      if (doctorId) {
        where = { ...where, doctor_id: doctorId };
      }
    } else if (user.role === UserRole.COLLABORATOR) {
      where = { ...where, created_by_id: userId };
    }

    let surgeryRequest =
      await this.surgeryRequestRepository.findOneSimple(where);
    if (!surgeryRequest)
      throw new NotFoundException('Surgery request not found');

    return surgeryRequest;
  }

  async update(data: UpdateSurgeryRequestDto, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });

    let where: FindOptionsWhere<SurgeryRequest> = { id: data.id };

    if (user.role === UserRole.ADMIN) {
      // Admin pode atualizar qualquer solicitação
    } else if (user.role === UserRole.DOCTOR) {
      const doctorId = await this.getDoctorId(userId);
      if (doctorId) {
        where = { ...where, doctor_id: doctorId };
      }
    } else if (user.role === UserRole.COLLABORATOR) {
      where = { ...where, created_by_id: userId };
    }

    let surgeryRequest =
      await this.surgeryRequestRepository.findOneSimple(where);
    if (!surgeryRequest)
      throw new NotFoundException('Surgery request not found');

    let hospitalId = surgeryRequest.hospital_id;
    const doctorId = await this.getDoctorId(userId);

    // Buscar ou criar hospital (agora é entidade separada)
    if (data.hospital?.name) {
      const hospital = await this.hospitalRepository.findOne({
        name: data.hospital.name,
      });

      if (hospital) {
        hospitalId = hospital.id;
      } else {
        const newHospital = await this.hospitalRepository.create({
          name: data.hospital.name,
          email: data.hospital.email,
          doctor_id: doctorId,
        });
        hospitalId = newHospital.id;
      }
    }

    // Buscar ou criar convênio (agora é entidade separada)
    let healthPlanId = surgeryRequest.health_plan_id;
    if (data.health_plan?.name) {
      let healthPlan = await this.healthPlanRepository.findOne({
        name: data.health_plan.name,
      });
      if (!healthPlan) {
        healthPlan = await this.healthPlanRepository.create({
          name: data.health_plan.name,
          email: data.health_plan.email,
          phone: data.health_plan.phone,
          doctor_id: doctorId,
        });
      }
      healthPlanId = healthPlan.id;
    }

    const requestId = data.id;

    // Remover propriedades que não fazem parte da entidade SurgeryRequest
    const { id, hospital: _hospital, health_plan, cid, ...validData } = data;

    if (cid && (!cid.id || !cid.description)) {
      // Não incluir cid_id se inválido
    }

    await this.surgeryRequestRepository.update(requestId, {
      ...validData,
      hospital_id: hospitalId,
      ...(cid && cid.id && { cid_id: cid.id }),
      health_plan_id: healthPlanId,
    });

    return surgeryRequest;
  }

  async updateBasic(data: UpdateSurgeryRequestBasicDto, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    let where: FindOptionsWhere<SurgeryRequest> = { id: data.id };

    if (user.role === UserRole.ADMIN) {
      // Admin pode atualizar qualquer solicitação
    } else if (user.role === UserRole.DOCTOR) {
      const doctorId = await this.getDoctorId(userId);
      if (doctorId) {
        where = { ...where, doctor_id: doctorId };
      }
    } else if (user.role === UserRole.COLLABORATOR) {
      where = { ...where, created_by_id: userId };
    }

    const surgeryRequest =
      await this.surgeryRequestRepository.findOneSimple(where);
    if (!surgeryRequest) {
      throw new NotFoundException('Surgery request not found');
    }

    // Preparar dados para atualização
    const updateData: any = {};

    if (data.priority !== undefined) {
      updateData.priority = data.priority;
    }

    if (data.deadline !== undefined) {
      updateData.deadline = data.deadline ? new Date(data.deadline) : null;
    }

    if (data.manager_id !== undefined) {
      updateData.manager_id = data.manager_id;
    }

    // Atualizar no banco
    await this.surgeryRequestRepository.update(data.id, updateData);

    // Buscar dados atualizados
    return await this.surgeryRequestRepository.findOneSimple({ id: data.id });
  }

  async updateStatus(
    surgeryRequestId: string,
    newStatus: number,
    userId: string,
  ) {
    try {
      // Buscar a solicitação cirúrgica
      const surgeryRequest = await this.surgeryRequestRepository.findOne({
        id: surgeryRequestId,
      });

      if (!surgeryRequest) {
        throw new NotFoundException(
          `Surgery request with ID ${surgeryRequestId} not found`,
        );
      }

      // Validar se o status é válido
      const validStatuses = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      if (!validStatuses.includes(newStatus)) {
        throw new BadRequestException(
          `Invalid status: ${newStatus}. Valid statuses are: ${validStatuses.join(', ')}`,
        );
      }

      // Atualizar o status e criar registro de histórico em uma transação
      const updated = await this.dataSource.transaction(async (manager) => {
        const surgeryRequestRepo = manager.getRepository(SurgeryRequest);
        const statusUpdateRepo = manager.getRepository(StatusUpdate);

        // Atualizar o status
        await surgeryRequestRepo.update(
          { id: surgeryRequestId },
          { status: newStatus },
        );

        // Criar registro de histórico
        await statusUpdateRepo.save({
          surgery_request_id: surgeryRequestId,
          prev_status: surgeryRequest.status,
          new_status: newStatus,
        });

        // Buscar request atualizado
        return await surgeryRequestRepo.findOne({
          where: { id: surgeryRequestId },
        });
      });

      return updated;
    } catch (error) {
      throw error;
    }
  }

  async contest(
    data: CreateContestSurgeryRequestDto,
    file: Express.Multer.File,
    userId: string,
  ) {
    const surgeryRequest = await this.surgeryRequestRepository.findOne({
      id: data.surgery_request_id,
    });
    if (!surgeryRequest)
      throw new NotFoundException('Surgery request not found');

    const respFile = await this.documentsService.create(
      {
        surgery_request_id: data.surgery_request_id,
        key: `document_${DocumentTypes.contestFile}`,
        name: 'Contestação',
      },
      userId,
      file,
    );

    const resp = await this.surgeryRequestRepository.update(
      data.surgery_request_id,
      {
        cancel_reason: data.cancel_reason,
        status: SurgeryRequestStatuses.inReanalysis.value,
      },
    );

    await this.statusUpdateRepository.create({
      surgery_request_id: data.surgery_request_id,
      new_status: SurgeryRequestStatuses.inReanalysis.value,
      prev_status: surgeryRequest.status,
    });

    return resp;
  }

  async complaint(data: CreateComplaintDto, userId: string) {
    const surgeryRequest = await this.surgeryRequestRepository.findOne({
      id: data.surgery_request_id,
    });
    if (!surgeryRequest)
      throw new NotFoundException('Surgery request not found');

    const resp = await this.surgeryRequestRepository.update(
      data.surgery_request_id,
      {
        date_call: data.date_call,
        protocol: data.protocol,
      },
    );

    return resp;
  }

  async dateExpired() {
    const surgeryRequests = await this.surgeryRequestRepository.findMany(
      { status: SurgeryRequestStatuses.inAnalysis.value },
      0,
      1000,
    );

    const surgeryRequestsWithDaysDifference = surgeryRequests
      .map((surgeryRequest) => {
        const createdAt = surgeryRequest.status_updates[0]?.created_at;
        const daysDifference = calculateDaysDifference(createdAt);

        return {
          ...surgeryRequest,
          daysDifference,
        };
      })
      .filter(
        (surgeryRequest) =>
          surgeryRequest.daysDifference >= 21 &&
          (!surgeryRequest.date_call || !surgeryRequest.protocol),
      );

    return surgeryRequestsWithDaysDifference;
  }

  /**
   * Transiciona manualmente para um status específico
   */
  async transitionToStatus(
    surgeryRequestId: string,
    newStatus: number,
    userId: string,
  ): Promise<SurgeryRequest> {
    const surgeryRequest = await this.surgeryRequestRepository.findOneSimple({
      id: surgeryRequestId,
    });

    if (!surgeryRequest) {
      throw new NotFoundException('Solicitação não encontrada');
    }

    const prevStatus = surgeryRequest.status;

    // Atualiza o status
    const updated = await this.surgeryRequestRepository.update(
      surgeryRequestId,
      { status: newStatus },
    );

    // Registra a atualização de status
    await this.statusUpdateRepository.create({
      surgery_request_id: surgeryRequestId,
      prev_status: prevStatus,
      new_status: newStatus,
    });

    return updated;
  }

  /**
   * Aprovar solicitação (transição manual de Em Análise para Em Agendamento)
   */
  async approve(
    surgeryRequestId: string,
    userId: string,
  ): Promise<SurgeryRequest> {
    const surgeryRequest = await this.surgeryRequestRepository.findOneSimple({
      id: surgeryRequestId,
    });

    if (!surgeryRequest) {
      throw new NotFoundException('Solicitação não encontrada');
    }

    // Verificar se está em análise
    if (
      surgeryRequest.status !== surgeryRequestStatusesCommon.inAnalysis.value
    ) {
      throw new BadRequestException(
        'Solicitação precisa estar em análise para ser aprovada',
      );
    }

    // Transicionar para Em Agendamento
    return await this.transitionToStatus(
      surgeryRequestId,
      surgeryRequestStatusesCommon.inScheduling.value,
      userId,
    );
  }

  /**
   * Recusar solicitação (negar autorização) - volta para Pendente para correção
   */
  async deny(
    surgeryRequestId: string,
    contestReason: string,
    userId: string,
  ): Promise<SurgeryRequest> {
    const surgeryRequest = await this.surgeryRequestRepository.findOneSimple({
      id: surgeryRequestId,
    });

    if (!surgeryRequest) {
      throw new NotFoundException('Solicitação não encontrada');
    }

    // Atualiza com motivo de contestação e volta para Pendente
    const updated = await this.surgeryRequestRepository.update(
      surgeryRequestId,
      {
        cancel_reason: contestReason,
        status: surgeryRequestStatusesCommon.pending.value,
      },
    );

    // Registra a atualização de status
    await this.statusUpdateRepository.create({
      surgery_request_id: surgeryRequestId,
      prev_status: surgeryRequest.status,
      new_status: surgeryRequestStatusesCommon.pending.value,
    });

    return updated;
  }
}

function calculateDaysDifference(date: Date): number {
  const dayjs = require('dayjs');
  if (!date) {
    return 0;
  }
  const now = dayjs();
  const givenDate = dayjs(date);
  return now.diff(givenDate, 'day');
}
