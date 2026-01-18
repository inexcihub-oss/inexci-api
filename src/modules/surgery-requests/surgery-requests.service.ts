import { FindOptionsWhere, In, DataSource } from 'typeorm';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  DocumentTypes,
  PendencyKeys,
  SurgeryRequestStatuses,
  UserPvs,
  UserStatuses,
} from 'src/common';
import { UsersService } from '../users/users.service';
import { FindManySurgeryRequestDto } from './dto/find-many.dto';
import { StorageService } from 'src/shared/storage/storage.service';
import { CreateSurgeryRequestDto } from './dto/create-surgery-request.dto';
import { UserRepository } from 'src/database/repositories/user.repository';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { SurgeryRequestQuotationRepository } from 'src/database/repositories/surgery-request-quotation.repository';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { UpdateSurgeryRequestDto } from './dto/update-surgery-request.dto';
import { EmailService } from 'src/shared/email/email.service';
import surgeryRequestStatusesCommon from 'src/common/surgery-request-statuses.common';
import { PendenciesService } from './pendencies/pendencies.service';
import { SendSurgeryRequestDto } from './dto/send-surgery-request.dto';
import { StatusUpdateRepository } from 'src/database/repositories/status-update.repository';
import { PendencyRepository } from 'src/database/repositories/pendency.repository';
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
import { User } from 'src/database/entities/user.entity';
import { Chat } from 'src/database/entities/chat.entity';
import { Pendency } from 'src/database/entities/pendency.entity';
import { StatusUpdate } from 'src/database/entities/status-update.entity';
import { SurgeryRequestProcedure } from 'src/database/entities/surgery-request-procedure.entity';

@Injectable()
export class SurgeryRequestsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
    private readonly pendenciesService: PendenciesService,
    private readonly userService: UsersService,
    private readonly storageService: StorageService,
    private readonly documentsService: DocumentsService,
    private readonly documentsKeyService: DocumentsKeyService,
    private readonly userRepository: UserRepository,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly statusUpdateRepository: StatusUpdateRepository,
    private readonly pendencyRepository: PendencyRepository,
    private readonly surgeryRequestQuotationRepository: SurgeryRequestQuotationRepository,
  ) {}

  async create(data: CreateSurgeryRequestDto, userId: number) {
    const user = await this.userRepository.findOne({ id: userId });

    return await this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const surgeryRequestRepo = manager.getRepository(SurgeryRequest);
      const chatRepo = manager.getRepository(Chat);
      const pendencyRepo = manager.getRepository(Pendency);
      const statusUpdateRepo = manager.getRepository(StatusUpdate);
      const surgeryRequestProcedureRepo = manager.getRepository(
        SurgeryRequestProcedure,
      );

      let collaborator = await this.userRepository.findOne({
        email: data.collaborator.email,
      });
      if (!collaborator)
        collaborator = await this.userService.create(
          {
            pv: UserPvs.collaborator,
            status: data.collaborator.status,
            name: data.collaborator.name,
            email: data.collaborator.email,
            phone: data.collaborator.phone,
            clinic_id: user.clinic_id,
          },
          userId,
        );

      let patient = await this.userRepository.findOne({
        email: data.patient.email,
        pv: UserPvs.patient,
      });
      if (!patient) {
        patient = await userRepo.save({
          pv: UserPvs.patient,
          status: UserStatuses.incomplete,
          name: data.patient.name,
          email: data.patient.email,
          phone: data.patient.phone,
          clinic_id: user.clinic_id,
        });
        this.emailService.sendCompleteRegisterEmail(
          data.patient.email,
          {
            id: patient.id,
            name: data.patient.name,
          },
          true,
        );
      }

      let healthPlan = await this.userRepository.findOne({
        email: data.health_plan.email,
        pv: UserPvs.health_plan,
      });
      if (!healthPlan) {
        healthPlan = await userRepo.save({
          pv: UserPvs.health_plan,
          status: UserStatuses.incomplete,
          name: data.health_plan.name,
          email: data.health_plan.email,
          phone: data.health_plan.phone,
          clinic_id: user.clinic_id,
        });
        this.emailService.sendCompleteRegisterEmail(
          data.health_plan.email,
          {
            id: healthPlan.id,
            name: data.health_plan.name,
          },
          true,
        );
      }

      const statusData = surgeryRequestStatusesCommon.pending;

      const newRequest = await surgeryRequestRepo.save({
        doctor_id: userId,
        responsible_id: collaborator.id,
        patient_id: patient.id,
        status: statusData.value,
        is_indication: data.is_indication,
        indication_name: data.indication_name,
        health_plan_id: healthPlan.id,
      });

      // Adicionar procedimento se não for indicação
      if (!data.is_indication && data.procedure_id) {
        await surgeryRequestProcedureRepo.save({
          surgery_request_id: newRequest.id,
          procedure_id: data.procedure_id,
          quantity: 1,
        });
      }

      await chatRepo.save({
        surgery_request_id: newRequest.id,
        user_id: patient.id,
      });

      const pendenciesToCreate: any[] = [];
      statusData.defaultPendencies.forEach((item) => {
        pendenciesToCreate.push({
          surgery_request_id: newRequest.id,
          responsible_id: newRequest.responsible_id,
          key: item.key,
          name: item.name,
          description: item.description,
        });
      });

      const defaultDocumentClinic = await this.documentsKeyService.findAll(
        null,
        userId,
      );
      defaultDocumentClinic.records.forEach((records) => {
        pendenciesToCreate.push({
          surgery_request_id: newRequest.id,
          responsible_id: newRequest.responsible_id,
          key: records.key,
          name: 'Inserir documento',
          description: `Inserir ${records.name}`,
        });
      });

      await pendencyRepo.save(pendenciesToCreate);

      await statusUpdateRepo.save({
        surgery_request_id: newRequest.id,
        prev_status: statusData.value,
        new_status: statusData.value,
      });

      return newRequest;
    });
  }

  async send(data: SendSurgeryRequestDto, userId: number) {
    const surgeryRequest = await this.surgeryRequestRepository.findOne({
      id: data.id,
    });

    const pendencies = await this.pendencyRepository.findMany({
      surgery_request_id: data.id,
      concluded_at: null,
    });

    if (pendencies.length > 0)
      throw new BadRequestException('A solicitação ainda possui pendências');

    const statusData = surgeryRequestStatusesCommon.sent;

    const pendenciesToCreate: any[] = [];

    statusData.defaultPendencies.forEach((item) => {
      pendenciesToCreate.push({
        surgery_request_id: data.id,
        responsible_id: surgeryRequest.responsible_id,
        key: item.key,
        name: item.name,
        description: item.description,
      });
    });

    return await this.dataSource.transaction(async (manager) => {
      const surgeryRequestRepo = manager.getRepository(SurgeryRequest);
      const statusUpdateRepo = manager.getRepository(StatusUpdate);
      const pendencyRepo = manager.getRepository(Pendency);

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
        pendencyRepo.save(pendenciesToCreate),
      ]);
    });
  }

  async cancel(data: SendSurgeryRequestDto, userId: number) {
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

  async schedule(data: ScheduleSurgeryRequestDto, userId: number) {
    const surgeryRequest = await this.surgeryRequestRepository.findOne({
      id: data.id,
    });
    if (!surgeryRequest)
      throw new NotFoundException('Solicitação não encontrada');

    const statusData = surgeryRequestStatusesCommon.scheduled;

    const pendenciesToCreate: any[] = [];

    statusData.defaultPendencies.forEach((item) => {
      pendenciesToCreate.push({
        surgery_request_id: data.id,
        responsible_id: surgeryRequest.responsible_id,
        key: item.key,
        name: item.name,
        description: item.description,
      });
    });

    return await this.dataSource.transaction(async (manager) => {
      const surgeryRequestRepo = manager.getRepository(SurgeryRequest);
      const statusUpdateRepo = manager.getRepository(StatusUpdate);
      const pendencyRepo = manager.getRepository(Pendency);

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
        pendencyRepo.save(pendenciesToCreate),
      ]);
    });
  }

  async toInvoice(data: ToInvoiceDto, userId: number) {
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

  async receive(data: ReceiveDto, userId: number) {
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

  async invoice(data: InvoiceDto, userId: number, file: Express.Multer.File) {
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

  async createDateOptions(data: CreateSurgeryDateOptions, userId: number) {
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

  async findAll(query: FindManySurgeryRequestDto, userId: number) {
    let where: FindOptionsWhere<SurgeryRequest> = {};

    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    if (query.status) {
      where = { ...where, status: In(query.status) };
    }

    if (user.pv === UserPvs.doctor) {
      where = { ...where, doctor_id: user.id };
    } else if (user.pv === UserPvs.collaborator) {
      where = { ...where, responsible_id: user.id };
    } else if (user.pv === UserPvs.hospital) {
      where = { ...where, hospital_id: user.id };
    } else if (user.pv === UserPvs.patient) {
      where = { ...where, patient_id: user.id };
    } else if (user.pv === UserPvs.supplier) {
      // TypeORM não suporta 'some' - precisamos buscar via quotations
      const quotations = await this.surgeryRequestQuotationRepository.findMany({
        supplier_id: user.id,
      });
      const surgeryRequestIds = quotations.map((q) => q.surgery_request_id);
      if (surgeryRequestIds.length > 0) {
        where = { ...where, id: In(surgeryRequestIds) };
      } else {
        // Se não tem quotations, retorna vazio
        return { total: 0, records: [] };
      }
    }

    const [total, records] = await Promise.all([
      this.surgeryRequestRepository.total(where),
      this.surgeryRequestRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }

  async findOne(id: number, userId: number) {
    let where: FindOptionsWhere<SurgeryRequest> = { id };
    let whereChat: any = {};
    let whereQuotation: any = {};

    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    if (user.pv === UserPvs.doctor) {
      where = { ...where, doctor_id: user.id };
    } else if (user.pv === UserPvs.collaborator) {
      where = { ...where, responsible_id: user.id };
    } else if (user.pv === UserPvs.hospital) {
      where = { ...where, hospital_id: user.id };
      whereChat = { ...whereChat, user_id: user.id };
    } else if (user.pv === UserPvs.patient) {
      where = { ...where, patient_id: user.id };
      whereChat = { ...whereChat, user_id: user.id };
    } else if (user.pv === UserPvs.supplier) {
      // Verificar se o supplier tem quotations para esta request
      const quotation = await this.surgeryRequestQuotationRepository.findOne({
        surgery_request_id: id,
        supplier_id: user.id,
      });
      if (!quotation) throw new NotFoundException('Surgery request not found');
      whereChat = { ...whereChat, user_id: user.id };
      whereQuotation = { ...whereQuotation, supplier_id: user.id };
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

  async findOneSimple(id: number, userId: number) {
    let where: FindOptionsWhere<SurgeryRequest> = { id };

    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    if (user.pv === UserPvs.doctor) {
      where = { ...where, doctor_id: user.id };
    } else if (user.pv === UserPvs.collaborator) {
      where = { ...where, responsible_id: user.id };
    }

    let surgeryRequest =
      await this.surgeryRequestRepository.findOneSimple(where);
    if (!surgeryRequest)
      throw new NotFoundException('Surgery request not found');

    return surgeryRequest;
  }

  async update(data: UpdateSurgeryRequestDto, userId: number) {
    const user = await this.userRepository.findOne({ id: userId });

    let where: FindOptionsWhere<SurgeryRequest> = { id: data.id };

    if (user.pv === UserPvs.doctor) {
      where = { ...where, doctor_id: userId };
    } else {
      where = { ...where, responsible_id: userId };
    }

    let surgeryRequest =
      await this.surgeryRequestRepository.findOneSimple(where);
    if (!surgeryRequest)
      throw new NotFoundException('Surgery request not found');

    let hospitalId = null;

    const hospital = await this.userRepository.findOne({
      email: data.hospital.email,
      pv: UserPvs.hospital,
    });

    if (hospital) {
      hospitalId = hospital.id;
    } else {
      const newHospital = await this.userRepository.create({
        pv: UserPvs.hospital,
        status: UserStatuses.incomplete,
        email: data.hospital.email,
        name: data.hospital.name,
      });
      hospitalId = newHospital.id;
      this.emailService.sendCompleteRegisterEmail(data.hospital.email, {
        id: hospitalId,
        name: data.hospital.name,
      });
    }

    let healthPlan = await this.userRepository.findOne({
      email: data.health_plan.email,
      pv: UserPvs.health_plan,
    });
    if (!healthPlan) {
      healthPlan = await this.userRepository.create({
        pv: UserPvs.health_plan,
        status: UserStatuses.incomplete,
        name: data.health_plan.name,
        email: data.health_plan.email,
        phone: data.health_plan.phone,
      });
      this.emailService.sendCompleteRegisterEmail(
        data.health_plan.email,
        {
          id: healthPlan.id,
          name: data.health_plan.name,
        },
        true,
      );
    }

    const requestId = data.id;

    // Remover propriedades que não fazem parte da entidade SurgeryRequest
    const { id, hospital: _hospital, health_plan, cid, ...validData } = data;

    if (cid && (!cid.id || !cid.description)) {
      // Não incluir cid_id se inválido
    }

    await Promise.all([
      this.surgeryRequestRepository.update(requestId, {
        ...validData,
        hospital_id: hospitalId,
        ...(cid && cid.id && { cid_id: cid.id }),
        health_plan_id: healthPlan.id,
      }),
      this.pendenciesService.close({
        key: PendencyKeys.completeFields,
        surgery_request_id: requestId,
      }),
    ]);

    return surgeryRequest;
  }

  async updateStatus(
    surgeryRequestId: number,
    newStatus: number,
    userId: number,
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
      const validStatuses = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
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
    userId: number,
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
        contest_reason: data.contest_reason,
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

  async complaint(data: CreateComplaintDto, userId: number) {
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
