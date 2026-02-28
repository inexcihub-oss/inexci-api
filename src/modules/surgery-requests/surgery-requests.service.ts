import { FindOptionsWhere, In, DataSource, Repository } from 'typeorm';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DocumentTypes } from 'src/common';
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
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { SurgeryRequestAnalysis } from 'src/database/entities/surgery-request-analysis.entity';
import { SurgeryRequestBilling } from 'src/database/entities/surgery-request-billing.entity';
import { Contestation } from 'src/database/entities/contestation.entity';
import { HealthPlan } from 'src/database/entities/health-plan.entity';
import { Hospital } from 'src/database/entities/hospital.entity';
import { Patient } from 'src/database/entities/patient.entity';
import { Chat } from 'src/database/entities/chat.entity';
import { StatusUpdate } from 'src/database/entities/status-update.entity';
import { User, UserRole } from 'src/database/entities/user.entity';
import {
  SurgeryRequestActivity,
  ActivityType,
} from 'src/database/entities/surgery-request-activity.entity';
import { UpdateSurgeryRequestDto } from './dto/update-surgery-request.dto';
import { UpdateSurgeryRequestBasicDto } from './dto/update-surgery-request-basic.dto';
import { EmailService } from 'src/shared/email/email.service';
import { MailService } from 'src/shared/mail/mail.service';
import { PdfService } from 'src/shared/pdf/pdf.service';
import { PendencyValidatorService } from './pendencies/pendency-validator.service';
import { StatusUpdateRepository } from 'src/database/repositories/status-update.repository';
import { DocumentsService } from './documents/documents.service';
import { DocumentsKeyService } from './documents-key/documents-key.service';
import { SurgeryRequestStateMachine } from 'src/shared/state-machine/surgery-request-state-machine';

// ── DTOs de transição ────────────────────────────────────────────────────────
import { SendRequestDto } from './dto/send-request.dto';
import { StartAnalysisDto } from './dto/start-analysis.dto';
import { AcceptAuthorizationDto } from './dto/accept-authorization.dto';
import { ContestAuthorizationDto } from './dto/contest-authorization.dto';
import { ConfirmDateDto } from './dto/confirm-date.dto';
import { UpdateDateOptionsDto } from './dto/update-date-options.dto';
import { RescheduleDto } from './dto/reschedule.dto';
import { MarkPerformedDto } from './dto/mark-performed.dto';
import { InvoiceRequestDto } from './dto/invoice-request.dto';
import { ConfirmReceiptDto } from './dto/confirm-receipt.dto';
import { ContestPaymentDto } from './dto/contest-payment.dto';
import { UpdateReceiptDto } from './dto/update-receipt.dto';
import { CloseSurgeryRequestDto } from './dto/close-surgery-request.dto';
import { FindManyDocumentKeyDto } from './documents-key/dto/find-many-dto';

@Injectable()
export class SurgeryRequestsService {
  private readonly logger = new Logger(SurgeryRequestsService.name);
  private readonly stateMachine = new SurgeryRequestStateMachine();

  constructor(
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
    private readonly mailService: MailService,
    private readonly pdfService: PdfService,
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
    @InjectRepository(SurgeryRequestAnalysis)
    private readonly analysisRepository: Repository<SurgeryRequestAnalysis>,
    @InjectRepository(SurgeryRequestBilling)
    private readonly billingRepository: Repository<SurgeryRequestBilling>,
    @InjectRepository(Contestation)
    private readonly contestationRepository: Repository<Contestation>,
  ) {}

  // ============================================================
  // HELPERS PRIVADOS
  // ============================================================

  private async getDoctorId(userId: string): Promise<string | null> {
    const user = await this.userRepository.findOne({ id: userId });
    if (user.role === UserRole.DOCTOR) {
      const doctorProfile =
        await this.doctorProfileRepository.findByUserId(userId);
      return doctorProfile?.id || null;
    }
    return null;
  }

  /** Carrega solicitação com todas as relações necessárias para a state machine */
  private async loadRequestWithRelations(id: string): Promise<SurgeryRequest> {
    const request = await this.surgeryRequestRepository.findOneWithRelations(
      { id },
      [
        'created_by',
        'patient',
        'hospital',
        'health_plan',
        'tuss_items',
        'opme_items',
        'documents',
        'analysis',
        'billing',
        'contestations',
      ],
    );
    if (!request) throw new NotFoundException('Solicitação não encontrada');
    return request;
  }

  /** Rótulos legíveis por humanos para cada status */
  private readonly statusLabels: Record<number, string> = {
    1: 'Pendente',
    2: 'Enviada',
    3: 'Em Análise',
    4: 'Em Agendamento',
    5: 'Agendada',
    6: 'Realizada',
    7: 'Faturada',
    8: 'Finalizada',
    9: 'Encerrada',
  };

  /** Registra mudança de status em status_updates e em activities */
  private async recordStatusChange(
    manager: any,
    surgeryRequestId: string,
    prevStatus: SurgeryRequestStatus,
    newStatus: SurgeryRequestStatus,
    userId: string | null = null,
  ): Promise<void> {
    const statusUpdateRepo = manager.getRepository(StatusUpdate);
    await statusUpdateRepo.save({
      surgery_request_id: surgeryRequestId,
      prev_status: prevStatus,
      new_status: newStatus,
    });

    const activityRepo = manager.getRepository(SurgeryRequestActivity);
    const prevLabel = this.statusLabels[prevStatus] ?? String(prevStatus);
    const newLabel = this.statusLabels[newStatus] ?? String(newStatus);
    await activityRepo.save({
      surgery_request_id: surgeryRequestId,
      user_id: userId,
      type: ActivityType.STATUS_CHANGE,
      content: `Status alterado de "${prevLabel}" para "${newLabel}"`,
    });
  }

  // ============================================================
  // CRIAÇÃO
  // ============================================================

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
            password: data.collaborator.password,
          });
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

      const newRequest = await surgeryRequestRepo.save({
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

      return newRequest;
    });
  }

  // ============================================================
  // LEITURA
  // ============================================================

  async findAll(query: FindManySurgeryRequestDto, userId: string) {
    let where: FindOptionsWhere<SurgeryRequest> = {};
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    if (query.status) {
      where = { ...where, status: In(query.status) };
    }

    if (user.role === UserRole.DOCTOR) {
      const doctorId = await this.getDoctorId(userId);
      if (doctorId) where = { ...where, doctor_id: doctorId };
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
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    if (user.role === UserRole.DOCTOR) {
      const doctorId = await this.getDoctorId(userId);
      if (doctorId) where = { ...where, doctor_id: doctorId };
    } else if (user.role === UserRole.COLLABORATOR) {
      where = { ...where, created_by_id: userId };
    }

    const surgeryRequest = await this.surgeryRequestRepository.findOne(where);
    if (!surgeryRequest)
      throw new NotFoundException('Surgery request not found');

    // Computar campo `receipt` derivado de `billing` para facilitar leitura no
    // frontend: presente quando o recebimento foi confirmado (received_value ≠ null).
    const billing = (surgeryRequest as any).billing;
    const receipt =
      billing?.received_value != null
        ? {
            received_value: Number(billing.received_value),
            received_at: billing.received_at,
            receipt_notes: billing.receipt_notes ?? null,
            is_contested: billing.contested_received_value != null,
            contested_received_value: billing.contested_received_value
              ? Number(billing.contested_received_value)
              : null,
            contested_received_at: billing.contested_received_at ?? null,
          }
        : null;

    // Converter uri dos documentos para URL pública do Supabase
    const rawRequest = surgeryRequest as any;
    if (Array.isArray(rawRequest.documents)) {
      rawRequest.documents = await Promise.all(
        rawRequest.documents.map(async (doc: any) => {
          try {
            return {
              ...doc,
              path: doc.uri,
              uri: await this.storageService.getSignedUrl(doc.uri),
            };
          } catch {
            return doc;
          }
        }),
      );
    }

    return { ...rawRequest, receipt };
  }

  async findOneSimple(id: string, userId: string) {
    let where: FindOptionsWhere<SurgeryRequest> = { id };
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    if (user.role === UserRole.DOCTOR) {
      const doctorId = await this.getDoctorId(userId);
      if (doctorId) where = { ...where, doctor_id: doctorId };
    } else if (user.role === UserRole.COLLABORATOR) {
      where = { ...where, created_by_id: userId };
    }

    const surgeryRequest =
      await this.surgeryRequestRepository.findOneSimple(where);
    if (!surgeryRequest)
      throw new NotFoundException('Surgery request not found');
    return surgeryRequest;
  }

  // ============================================================
  // ATUALIZAÇÃO GERAL
  // ============================================================

  async update(data: UpdateSurgeryRequestDto, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    let where: FindOptionsWhere<SurgeryRequest> = { id: data.id };

    if (user.role === UserRole.DOCTOR) {
      const doctorId = await this.getDoctorId(userId);
      if (doctorId) where = { ...where, doctor_id: doctorId };
    } else if (user.role === UserRole.COLLABORATOR) {
      where = { ...where, created_by_id: userId };
    }

    const surgeryRequest =
      await this.surgeryRequestRepository.findOneSimple(where);
    if (!surgeryRequest)
      throw new NotFoundException('Surgery request not found');

    let hospitalId: string | null = surgeryRequest.hospital_id;
    const doctorId = await this.getDoctorId(userId);

    if (data.hospital === null) {
      hospitalId = null;
    } else if (data.hospital?.name) {
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

    let healthPlanId: string | null = surgeryRequest.health_plan_id;
    if (data.health_plan === null) {
      healthPlanId = null;
    } else if (data.health_plan?.name) {
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
    if (!user) throw new NotFoundException('User not found');

    let where: FindOptionsWhere<SurgeryRequest> = { id: data.id };
    if (user.role === UserRole.DOCTOR) {
      const doctorId = await this.getDoctorId(userId);
      if (doctorId) where = { ...where, doctor_id: doctorId };
    } else if (user.role === UserRole.COLLABORATOR) {
      where = { ...where, created_by_id: userId };
    }

    const surgeryRequest =
      await this.surgeryRequestRepository.findOneSimple(where);
    if (!surgeryRequest)
      throw new NotFoundException('Surgery request not found');

    const updateData: Partial<SurgeryRequest> = {};
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.deadline !== undefined)
      updateData.deadline = data.deadline ? new Date(data.deadline) : null;
    if (data.manager_id !== undefined) updateData.manager_id = data.manager_id;

    await this.surgeryRequestRepository.update(data.id, updateData);
    return this.surgeryRequestRepository.findOneSimple({ id: data.id });
  }

  // ============================================================
  // FASE 4.2 — ENDPOINTS DE TRANSIÇÃO DE STATUS
  // ============================================================

  /**
   * POST /surgery-requests/:id/send
   * PENDING → SENT
   */
  async sendRequest(id: string, dto: SendRequestDto, userId: string) {
    const request = await this.loadRequestWithRelations(id);
    this.stateMachine.assertCanTransition(request, SurgeryRequestStatus.SENT);

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurgeryRequest);
      await repo.update(
        { id },
        {
          status: SurgeryRequestStatus.SENT,
          sent_at: new Date(),
          send_method: dto.method,
        },
      );
      await this.recordStatusChange(
        manager,
        id,
        request.status,
        SurgeryRequestStatus.SENT,
        userId,
      );
    });

    const doctorName = request.created_by?.name ?? 'Médico';
    const patientName = request.patient?.name ?? 'Paciente';
    const healthPlanName = request.health_plan?.name ?? '';
    const hospitalName = request.hospital?.name ?? '';

    if (dto.method === 'email' && dto.to) {
      await this.mailService.sendSurgeryRequestSent(dto.to, {
        patientName,
        requestId: request.protocol ?? id,
        hospitalName,
        healthPlanName,
        doctorName,
      });
      return { sent: true, method: 'email' };
    }

    if (dto.method === 'download') {
      // ── Dados do médico ────────────────────────────────────────────────────
      const doctor = await this.userRepository.findOneWithProfile({
        id: userId,
      });
      const profile = (doctor as any)?.doctor_profile;

      let doctorCrm: string | undefined;
      if (profile?.crm) {
        doctorCrm = `CRM ${profile.crm}${profile.crm_state ? `/${profile.crm_state}` : ''}`;
      }
      const doctorEmail = doctor?.email ?? '';
      const doctorPhoneRaw = doctor?.phone ?? '';

      // ── Assinatura do médico (signed URL se for path) ─────────────────────────────────────────
      let doctorSignatureUrl: string | undefined;
      if (profile?.signature_url) {
        const rawSig: string = profile.signature_url;
        if (rawSig.startsWith('http')) {
          doctorSignatureUrl = rawSig;
        } else {
          try {
            doctorSignatureUrl = await this.storageService.getSignedUrl(rawSig);
          } catch {
            // sem assinatura
          }
        }
      }

      // Formatar telefone: (XX) XXXXX-XXXX
      const digitsOnly = (v: string) => (v ? v.replace(/\D/g, '') : '');
      const formatPhone = (v: string) => {
        const d = digitsOnly(v).slice(0, 11);
        if (d.length <= 10)
          return d.length > 6
            ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
            : d;
        return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
      };
      const doctorPhoneFormatted = formatPhone(doctorPhoneRaw);

      // ── Dados do laudo (medical_report JSON) ───────────────────────────────
      let reportData: {
        patientData?: {
          name?: string;
          birthDate?: string;
          rg?: string;
          cpf?: string;
          phone?: string;
          address?: string;
          zipCode?: string;
          healthPlan?: string;
        };
        historyAndDiagnosis?: string;
        conduct?: string;
      } = {};
      try {
        if (request.medical_report) {
          reportData = JSON.parse(request.medical_report as unknown as string);
        }
      } catch {
        // fallback vazio
      }

      const pd = reportData.patientData ?? {};
      const patient = (request as any).patient;

      // Formatar CPF
      const formatCpf = (v: string) => {
        const d = digitsOnly(v).slice(0, 11);
        if (d.length <= 3) return d;
        if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
        if (d.length <= 9)
          return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
        return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
      };
      // Formatar CEP
      const formatCep = (v: string) => {
        const d = digitsOnly(v).slice(0, 8);
        if (d.length <= 5) return d;
        return `${d.slice(0, 5)}-${d.slice(5)}`;
      };
      // Formatar data BR
      const formatDateBR = (v: string) => {
        if (!v) return '';
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return v;
        const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[3]}/${m[2]}/${m[1]}`;
        return v;
      };

      // ── Imagens dos exames ─────────────────────────────────────────────────
      const allDocs = (request as any).documents ?? [];
      const examDocs = allDocs.filter((d: any) => d.key === 'report_images');
      const examImages: string[] = (
        await Promise.all(
          examDocs.map(async (doc: any) => {
            const raw: string = doc.uri;
            if (!raw) return null;
            if (raw.startsWith('http')) return raw;
            try {
              return await this.storageService.getSignedUrl(raw);
            } catch {
              return null;
            }
          }),
        )
      ).filter((u): u is string => !!u);

      // ── Procedimentos (TUSS) ───────────────────────────────────────────────
      const tussItems = (request as any).tuss_items ?? [];
      const procedures = tussItems.map((item: any) => ({
        name: item.name,
        tussCode: item.tuss_code,
        quantity: item.quantity ?? 1,
      }));

      // ── Materiais (OPME) ───────────────────────────────────────────────────
      const opmeItemsRaw = (request as any).opme_items ?? [];
      const opmeItems = opmeItemsRaw.map((item: any) => ({
        name: item.name,
        quantity: item.quantity ?? 1,
      }));

      // ── Fabricantes e Fornecedores ─────────────────────────────────────────
      const unique = (arr: string[]) =>
        Array.from(new Set(arr.filter(Boolean)));
      const fabricantes = unique(
        opmeItemsRaw.map((i: any) => i.brand).filter(Boolean),
      );
      const fornecedores = unique(
        opmeItemsRaw.map((i: any) => i.distributor).filter(Boolean),
      );
      const fabricantesText =
        fabricantes.length > 0 ? fabricantes.join(', ') : '';
      const fornecedoresText =
        fornecedores.length > 0 ? fornecedores.join(', ') : '';
      const hasSeparator = fabricantes.length > 0 || fornecedores.length > 0;

      // ── Hospital (local) ───────────────────────────────────────────────────
      const hospital = (request as any).hospital;
      const localText = [hospital?.name, hospital?.address]
        .filter(Boolean)
        .join(' – ');

      const laudoData: import('src/shared/pdf/pdf.service').SurgeryRequestLaudoPdfData =
        {
          today: new Date().toLocaleDateString('pt-BR'),
          patientName: pd.name || patient?.name || undefined,
          patientBirthDate:
            pd.birthDate ||
            (patient?.birth_date
              ? formatDateBR(patient.birth_date)
              : undefined),
          patientRg: pd.rg || patient?.rg || undefined,
          patientCpf: formatCpf(pd.cpf || patient?.cpf || '') || undefined,
          patientPhone:
            formatPhone(pd.phone || patient?.phone || '') || undefined,
          patientAddress: pd.address || patient?.address || undefined,
          patientZipCode:
            formatCep(pd.zipCode || patient?.zip_code || patient?.cep || '') ||
            undefined,
          patientHealthPlan:
            pd.healthPlan || (request as any).health_plan?.name || undefined,
          historyAndDiagnosis: reportData.historyAndDiagnosis || undefined,
          conduct: reportData.conduct || undefined,
          examImages: examImages.length ? examImages : undefined,
          procedures: procedures.length ? procedures : undefined,
          opmeItems: opmeItems.length ? opmeItems : undefined,
          fabricantesText: fabricantesText || undefined,
          fornecedoresText: fornecedoresText || undefined,
          hasSeparator,
          localText: localText || undefined,
          doctorName: doctor?.name ?? 'Médico',
          doctorEmail: doctorEmail || undefined,
          doctorPhone: doctorPhoneFormatted || undefined,
          doctorSpecialty: profile?.specialty || undefined,
          doctorCrm: doctorCrm || undefined,
          hasDoctorContact: !!(doctorEmail || doctorPhoneFormatted),
          hasDoctorInfo: !!(doctor?.name || profile?.specialty || doctorCrm),
          doctorSignatureUrl: doctorSignatureUrl || undefined,
        };

      const summaryBuffer =
        await this.pdfService.generateSurgeryRequestLaudoPdf(laudoData);

      // ── Buscar documentos da aba Informações Gerais (pasta documents/) ──
      const infoDocs = allDocs.filter(
        (d: any) =>
          d.uri &&
          String(d.uri).startsWith('documents/') &&
          d.key !== 'report_images',
      );

      const docBuffers: Buffer[] = [];
      for (const doc of infoDocs) {
        try {
          const signedUrl = await this.storageService.getSignedUrl(doc.uri);
          const buf = await this.pdfService.fetchBuffer(signedUrl);
          if (buf) docBuffers.push(buf);
        } catch (err: any) {
          this.logger.warn(
            `[sendRequest] Não foi possível buscar documento "${doc.uri}": ${err?.message}`,
          );
        }
      }

      // ── Mesclar resumo + documentos em um único PDF ───────────────────────
      let finalBuffer = summaryBuffer;
      if (docBuffers.length > 0) {
        this.logger.log(
          `[sendRequest] Mesclando PDF com ${docBuffers.length} documento(s) anexo(s)`,
        );
        finalBuffer = await this.pdfService.mergePdfs([
          summaryBuffer,
          ...docBuffers,
        ]);
      }

      return { pdf: finalBuffer.toString('base64'), method: 'download' };
    }

    return { sent: true };
  }

  /**
   * POST /surgery-requests/:id/start-analysis
   * SENT → IN_ANALYSIS
   */
  async startAnalysis(id: string, dto: StartAnalysisDto, userId: string) {
    const request = await this.loadRequestWithRelations(id);
    if (request.status !== SurgeryRequestStatus.SENT) {
      throw new BadRequestException(
        'A solicitação precisa estar com status Enviada.',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurgeryRequest);
      const analysisRepo = manager.getRepository(SurgeryRequestAnalysis);

      await analysisRepo.save({
        surgery_request_id: id,
        request_number: dto.request_number,
        received_at: new Date(dto.received_at),
        quotation_1_number: dto.quotation_1_number,
        quotation_1_received_at: dto.quotation_1_received_at
          ? new Date(dto.quotation_1_received_at)
          : null,
        quotation_2_number: dto.quotation_2_number,
        quotation_2_received_at: dto.quotation_2_received_at
          ? new Date(dto.quotation_2_received_at)
          : null,
        quotation_3_number: dto.quotation_3_number,
        quotation_3_received_at: dto.quotation_3_received_at
          ? new Date(dto.quotation_3_received_at)
          : null,
        notes: dto.notes,
      });

      await repo.update({ id }, { status: SurgeryRequestStatus.IN_ANALYSIS });
      await this.recordStatusChange(
        manager,
        id,
        request.status,
        SurgeryRequestStatus.IN_ANALYSIS,
        userId,
      );
    });
  }

  /**
   * POST /surgery-requests/:id/accept-authorization
   * IN_ANALYSIS → IN_SCHEDULING
   */
  async acceptAuthorization(
    id: string,
    dto: AcceptAuthorizationDto,
    userId: string,
  ) {
    const request = await this.loadRequestWithRelations(id);
    this.stateMachine.assertCanTransition(
      request,
      SurgeryRequestStatus.IN_SCHEDULING,
    );

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurgeryRequest);
      const contestRepo = manager.getRepository(Contestation);

      // Resolver contestações de autorização ativas
      await contestRepo.update(
        {
          surgery_request_id: id,
          type: 'authorization',
          resolved_at: null as any,
        },
        { resolved_at: new Date() },
      );

      await repo.update(
        { id },
        {
          status: SurgeryRequestStatus.IN_SCHEDULING,
          date_options: dto.date_options,
        },
      );
      await this.recordStatusChange(
        manager,
        id,
        request.status,
        SurgeryRequestStatus.IN_SCHEDULING,
        userId,
      );
    });
  }

  /**
   * POST /surgery-requests/:id/contest-authorization
   * IN_ANALYSIS → IN_ANALYSIS (não muda status)
   */
  async contestAuthorization(
    id: string,
    dto: ContestAuthorizationDto,
    userId: string,
  ) {
    const request = await this.loadRequestWithRelations(id);
    if (request.status !== SurgeryRequestStatus.IN_ANALYSIS) {
      throw new BadRequestException(
        'A solicitação precisa estar Em Análise para ser contestada.',
      );
    }

    await this.contestationRepository.save({
      surgery_request_id: id,
      created_by_id: userId,
      type: 'authorization',
      reason: dto.reason,
    });

    const patientName = request.patient?.name ?? 'Paciente';
    const requestId = request.protocol ?? id;

    if (dto.method === 'email' && dto.to) {
      await this.mailService.sendSurgeryContested(
        dto.to,
        dto.subject ?? 'Contestação de Autorização — Inexci',
        {
          patientName,
          requestId,
          reason: dto.reason,
          message: dto.message,
        },
      );
      return { sent: true, method: 'email' };
    }

    return { sent: false, method: 'document' };
  }

  // ============================================================
  // PDF DA CONTESTAÇÃO DE AUTORIZAÇÃO
  // ============================================================

  /**
   * GET /surgery-requests/:id/contest-authorization-pdf
   * Gera o PDF da contestação à negativa de autorização cirúrgica.
   */
  async generateContestAuthorizationPdf(
    id: string,
    userId: string,
  ): Promise<Buffer> {
    const request = await this.loadRequestWithRelations(id);

    // ── Contestação mais recente do tipo 'authorization' ───────────────────
    const contestations = (request as any).contestations ?? [];
    const latestContestation = contestations
      .filter((c: any) => c.type === 'authorization')
      .sort(
        (a: any, b: any) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0];

    const reason =
      latestContestation?.reason ??
      'Venho por meio deste contestar a negativa de autorização referente aos códigos e materiais OPME solicitados.';

    // ── Dados do paciente ──────────────────────────────────────────────────
    const patient = (request as any).patient;

    // ── Itens TUSS vinculados ──────────────────────────────────────────────
    const { SurgeryRequestTussItem } =
      await import('src/database/entities/surgery-request-tuss-item.entity');
    const tussItems = await this.dataSource
      .getRepository(SurgeryRequestTussItem)
      .find({ where: { surgery_request_id: id } });

    const procedures = tussItems.map((item) => ({
      description: item.name,
      tussCode: item.tuss_code,
      requestedQuantity: item.quantity,
      authorizedQuantity: item.authorized_quantity ?? null,
    }));

    // ── OPME ───────────────────────────────────────────────────────────────
    const opmeItems = ((request as any).opme_items ?? []).map((item: any) => ({
      name: item.name,
      requestedQuantity: item.quantity,
      authorizedQuantity:
        item.authorized_quantity !== undefined
          ? item.authorized_quantity
          : null,
    }));

    // ── Médico ─────────────────────────────────────────────────────────────
    const doctor = await this.userRepository.findOneWithProfile({
      id: userId,
    });
    const profile = (doctor as any)?.doctor_profile;

    let doctorCrm: string | undefined;
    if (profile?.crm) {
      doctorCrm = `CRM ${profile.crm}${profile.crm_state ? `/${profile.crm_state}` : ''}`;
    }

    // ── Assinatura do médico ───────────────────────────────────────────────
    let doctorSignatureUrl: string | undefined;
    if (profile?.signature_url) {
      const raw: string = profile.signature_url;
      if (raw.startsWith('http')) {
        doctorSignatureUrl = raw;
      } else {
        try {
          doctorSignatureUrl = await this.storageService.getSignedUrl(raw);
        } catch {
          // sem assinatura
        }
      }
    }

    const pdfData: import('src/shared/pdf/pdf.service').ContestAuthorizationPdfData =
      {
        today: new Date().toLocaleDateString('pt-BR'),
        reason,
        patientName: patient?.name ?? undefined,
        patientBirthDate: patient?.birth_date
          ? new Date(patient.birth_date).toLocaleDateString('pt-BR')
          : undefined,
        patientRg: patient?.rg ?? undefined,
        patientCpf: patient?.cpf ?? undefined,
        patientPhone: patient?.phone ?? undefined,
        patientAddress: patient?.address ?? undefined,
        patientZipCode: patient?.zip_code ?? patient?.cep ?? undefined,
        patientHealthPlan: (request as any).health_plan?.name ?? undefined,
        procedures: procedures.length ? procedures : undefined,
        opmeItems: opmeItems.length ? opmeItems : undefined,
        doctorName: doctor?.name ?? 'Médico',
        doctorCrm,
        doctorSpecialty: profile?.specialty ?? undefined,
        doctorSignatureUrl,
      };

    return this.pdfService.generateContestAuthorizationPdf(pdfData);
  }

  /**
   * POST /surgery-requests/:id/confirm-date
   * IN_SCHEDULING → SCHEDULED
   */
  async confirmDate(id: string, dto: ConfirmDateDto, userId: string) {
    const request = await this.loadRequestWithRelations(id);
    if (request.status !== SurgeryRequestStatus.IN_SCHEDULING) {
      throw new BadRequestException(
        'A solicitação precisa estar Em Agendamento.',
      );
    }

    const dateOptions = request.date_options as string[];
    if (!dateOptions || dateOptions[dto.selected_date_index] === undefined) {
      throw new BadRequestException('Índice de data inválido.');
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurgeryRequest);
      await repo.update(
        { id },
        {
          status: SurgeryRequestStatus.SCHEDULED,
          selected_date_index: dto.selected_date_index,
          surgery_date: new Date(dateOptions[dto.selected_date_index]),
        },
      );
      await this.recordStatusChange(
        manager,
        id,
        request.status,
        SurgeryRequestStatus.SCHEDULED,
        userId,
      );
    });
  }

  /**
   * PATCH /surgery-requests/:id/date-options
   * IN_SCHEDULING → IN_SCHEDULING (sem mudar status)
   */
  async updateDateOptions(
    id: string,
    dto: UpdateDateOptionsDto,
    userId: string,
  ) {
    const request = await this.surgeryRequestRepository.findOneSimple({ id });
    if (!request) throw new NotFoundException('Solicitação não encontrada');
    if (request.status !== SurgeryRequestStatus.IN_SCHEDULING) {
      throw new BadRequestException(
        'A solicitação precisa estar Em Agendamento para atualizar datas.',
      );
    }

    await this.surgeryRequestRepository.update(id, {
      date_options: dto.date_options,
    });
  }

  /**
   * PATCH /surgery-requests/:id/reschedule
   * SCHEDULED → SCHEDULED (sem mudar status)
   */
  async reschedule(id: string, dto: RescheduleDto, userId: string) {
    const request = await this.surgeryRequestRepository.findOneSimple({ id });
    if (!request) throw new NotFoundException('Solicitação não encontrada');
    if (request.status !== SurgeryRequestStatus.SCHEDULED) {
      throw new BadRequestException(
        'A solicitação precisa estar Agendada para reagendar.',
      );
    }

    await this.surgeryRequestRepository.update(id, {
      surgery_date: new Date(dto.new_date),
    });
  }

  /**
   * POST /surgery-requests/:id/mark-performed
   * SCHEDULED → PERFORMED
   */
  async markPerformed(id: string, dto: MarkPerformedDto, userId: string) {
    const request = await this.loadRequestWithRelations(id);
    this.stateMachine.assertCanTransition(
      request,
      SurgeryRequestStatus.PERFORMED,
    );

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurgeryRequest);
      await repo.update(
        { id },
        {
          status: SurgeryRequestStatus.PERFORMED,
          surgery_performed_at: new Date(dto.surgery_performed_at),
        },
      );
      await this.recordStatusChange(
        manager,
        id,
        request.status,
        SurgeryRequestStatus.PERFORMED,
        userId,
      );
    });
  }

  /**
   * POST /surgery-requests/:id/invoice
   * PERFORMED → INVOICED
   */
  async invoiceRequest(id: string, dto: InvoiceRequestDto, userId: string) {
    const request = await this.loadRequestWithRelations(id);
    if (request.status !== SurgeryRequestStatus.PERFORMED) {
      throw new BadRequestException(
        'A solicitação precisa estar Realizada para ser faturada.',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurgeryRequest);
      const billingRepo = manager.getRepository(SurgeryRequestBilling);

      // Calcular payment_deadline
      let paymentDeadline: Date | null = null;
      if (dto.payment_deadline) {
        paymentDeadline = new Date(dto.payment_deadline);
      } else if (request.health_plan?.default_payment_days) {
        const d = new Date(dto.invoice_sent_at);
        d.setDate(d.getDate() + request.health_plan.default_payment_days);
        paymentDeadline = d;
      }

      await billingRepo.save({
        surgery_request_id: id,
        created_by_id: userId,
        invoice_protocol: dto.invoice_protocol,
        invoice_sent_at: new Date(dto.invoice_sent_at),
        invoice_value: dto.invoice_value,
        payment_deadline: paymentDeadline,
      });

      // Atualizar prazo padrão do plano se solicitado
      if (
        dto.set_as_default_for_health_plan &&
        request.health_plan_id &&
        dto.payment_deadline
      ) {
        const hpRepo = manager.getRepository(HealthPlan);
        const sentAt = new Date(dto.invoice_sent_at);
        const deadline = new Date(dto.payment_deadline);
        const days = Math.round(
          (deadline.getTime() - sentAt.getTime()) / (1000 * 60 * 60 * 24),
        );
        await hpRepo.update(
          { id: request.health_plan_id },
          { default_payment_days: days },
        );
      }

      await repo.update({ id }, { status: SurgeryRequestStatus.INVOICED });
      await this.recordStatusChange(
        manager,
        id,
        request.status,
        SurgeryRequestStatus.INVOICED,
        userId,
      );
    });
  }

  /**
   * POST /surgery-requests/:id/confirm-receipt
   * INVOICED → FINALIZED
   */
  async confirmReceipt(id: string, dto: ConfirmReceiptDto, userId: string) {
    const request = await this.loadRequestWithRelations(id);
    if (request.status !== SurgeryRequestStatus.INVOICED) {
      throw new BadRequestException(
        'A solicitação precisa estar Faturada para confirmar recebimento.',
      );
    }
    if (!request.billing) {
      throw new BadRequestException('Dados de faturamento não encontrados.');
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurgeryRequest);
      const billingRepo = manager.getRepository(SurgeryRequestBilling);

      const invoiceValue = Number(request.billing.invoice_value);
      const receivedValue = Number(dto.received_value);
      const hasDivergence = receivedValue !== invoiceValue;

      await billingRepo.update(
        { surgery_request_id: id },
        {
          received_value: receivedValue,
          received_at: new Date(dto.received_at),
          receipt_notes: dto.receipt_notes,
          // Registrar divergência
          contested_received_value: hasDivergence ? receivedValue : null,
          contested_received_at: hasDivergence ? new Date() : null,
        },
      );

      await repo.update({ id }, { status: SurgeryRequestStatus.FINALIZED });
      await this.recordStatusChange(
        manager,
        id,
        request.status,
        SurgeryRequestStatus.FINALIZED,
        userId,
      );

      return { hasDivergence, invoiceValue, receivedValue };
    });
  }

  /**
   * POST /surgery-requests/:id/contest-payment
   * FINALIZED → FINALIZED (não muda status — só registra contestação)
   */
  async contestPayment(id: string, dto: ContestPaymentDto, userId: string) {
    const request = await this.loadRequestWithRelations(id);
    if (request.status !== SurgeryRequestStatus.FINALIZED) {
      throw new BadRequestException(
        'A solicitação precisa estar Finalizada para contestar pagamento.',
      );
    }
    if (!request.billing?.contested_received_value) {
      throw new BadRequestException(
        'Não há divergência de recebimento registrada.',
      );
    }

    await this.contestationRepository.save({
      surgery_request_id: id,
      created_by_id: userId,
      type: 'payment',
      reason: dto.message,
    });

    const invoiceValue = request.billing?.invoice_value
      ? `R$ ${Number(request.billing.invoice_value).toFixed(2).replace('.', ',')}`
      : '—';
    const contestedValue = request.billing?.contested_received_value
      ? `R$ ${Number(request.billing.contested_received_value).toFixed(2).replace('.', ',')}`
      : '—';

    await this.mailService.sendPaymentContested(dto.to, dto.subject, {
      patientName: request.patient?.name ?? 'Paciente',
      requestId: request.protocol ?? id,
      invoiceValue,
      receivedValue: contestedValue,
      message: dto.message,
    });
  }

  /**
   * PATCH /surgery-requests/:id/billing/receipt
   * FINALIZED → FINALIZED (editar recebimento pós-contestação)
   */
  async updateReceipt(id: string, dto: UpdateReceiptDto, userId: string) {
    const request = await this.loadRequestWithRelations(id);
    if (request.status !== SurgeryRequestStatus.FINALIZED) {
      throw new BadRequestException('A solicitação precisa estar Finalizada.');
    }

    if (!request.billing?.contested_received_value) {
      throw new BadRequestException(
        'Não há divergência de recebimento para editar.',
      );
    }

    await this.billingRepository.update(
      { surgery_request_id: id },
      {
        received_value: dto.received_value,
        received_at: new Date(dto.received_at),
      },
    );
  }

  /**
   * POST /surgery-requests/:id/close
   * Qualquer → CLOSED (exceto FINALIZED e CLOSED)
   */
  async closeSurgeryRequest(
    id: string,
    dto: CloseSurgeryRequestDto,
    userId: string,
  ) {
    const request = await this.surgeryRequestRepository.findOneSimple({ id });
    if (!request) throw new NotFoundException('Solicitação não encontrada');

    this.stateMachine.assertCanTransition(
      request as any,
      SurgeryRequestStatus.CLOSED,
    );

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurgeryRequest);
      await repo.update(
        { id },
        {
          status: SurgeryRequestStatus.CLOSED,
          closed_at: new Date(),
          cancel_reason: dto.reason,
        },
      );
      await this.recordStatusChange(
        manager,
        id,
        request.status as SurgeryRequestStatus,
        SurgeryRequestStatus.CLOSED,
        userId,
      );
    });
  }

  /**
   * POST /surgery-requests/:id/notify
   * Envia manualmente um e-mail de notificação para o destinatário informado (ou o criador da solicitação).
   */
  async notify(
    id: string,
    dto: { template: string; to?: string },
    userId: string,
  ) {
    const request = await this.loadRequestWithRelations(id);
    if (!request) throw new NotFoundException('Solicitação não encontrada');

    const STATUS_TEMPLATE_MAP: Record<number, string[]> = {
      [SurgeryRequestStatus.SENT]: ['surgery-request-sent'],
      [SurgeryRequestStatus.IN_SCHEDULING]: ['surgery-authorized'],
      [SurgeryRequestStatus.IN_ANALYSIS]: ['surgery-contested'],
      [SurgeryRequestStatus.SCHEDULED]: ['surgery-scheduled'],
      [SurgeryRequestStatus.INVOICED]: ['invoice-sent'],
      [SurgeryRequestStatus.FINALIZED]: [
        'payment-received',
        'payment-contested',
      ],
    };

    const allowed = STATUS_TEMPLATE_MAP[request.status] ?? [];
    if (!allowed.includes(dto.template)) {
      throw new BadRequestException(
        `O template "${dto.template}" não é compatível com o status atual da solicitação.`,
      );
    }

    const to = dto.to ?? request.created_by?.email;
    if (!to) {
      throw new BadRequestException('Destinatário de e-mail não encontrado.');
    }

    const patientName = request.patient?.name ?? 'Paciente';
    const requestId = request.protocol ?? id;
    const doctorName = request.created_by?.name ?? 'Médico';
    const healthPlanName = request.health_plan?.name ?? '';
    const hospitalName = request.hospital?.name ?? '';

    switch (dto.template) {
      case 'surgery-request-sent':
        await this.mailService.sendSurgeryRequestSent(to, {
          patientName,
          requestId,
          hospitalName,
          healthPlanName,
          doctorName,
        });
        break;
      case 'surgery-authorized':
        await this.mailService.sendSurgeryAuthorized(to, {
          patientName,
          requestId,
          authorizedProcedures: (request.tuss_items ?? [])
            .filter((p) => p.authorized_quantity)
            .map((p) => p.name),
        });
        break;
      case 'surgery-contested':
        await this.mailService.sendSurgeryContested(
          to,
          'Contestação de Autorização — Inexci',
          {
            patientName,
            requestId,
            reason: 'Ver detalhes no sistema Inexci.',
          },
        );
        break;
      case 'surgery-scheduled':
        await this.mailService.sendSurgeryScheduled(to, {
          patientName,
          requestId,
          surgeryDate: request.surgery_date
            ? new Date(request.surgery_date).toLocaleDateString('pt-BR')
            : '—',
          hospitalName,
        });
        break;
      case 'invoice-sent':
        if (!request.billing)
          throw new BadRequestException('Sem dados de faturamento.');
        await this.mailService.sendInvoiceSent(to, {
          patientName,
          requestId,
          invoiceProtocol: request.billing.invoice_protocol,
          invoiceValue: `R$ ${Number(request.billing.invoice_value).toFixed(2).replace('.', ',')}`,
          paymentDeadline: request.billing.payment_deadline
            ? new Date(request.billing.payment_deadline).toLocaleDateString(
                'pt-BR',
              )
            : undefined,
        });
        break;
      case 'payment-received':
        if (!request.billing)
          throw new BadRequestException('Sem dados de faturamento.');
        await this.mailService.sendPaymentReceived(to, {
          patientName,
          requestId,
          receivedValue: `R$ ${Number(request.billing.received_value).toFixed(2).replace('.', ',')}`,
          receivedAt: request.billing.received_at
            ? new Date(request.billing.received_at).toLocaleDateString('pt-BR')
            : '—',
        });
        break;
      case 'payment-contested':
        if (!request.billing)
          throw new BadRequestException('Sem dados de faturamento.');
        await this.mailService.sendPaymentContested(
          to,
          'Contestação de Pagamento — Inexci',
          {
            patientName,
            requestId,
            invoiceValue: `R$ ${Number(request.billing.invoice_value).toFixed(2).replace('.', ',')}`,
            receivedValue: `R$ ${Number(
              request.billing.contested_received_value ??
                request.billing.received_value,
            )
              .toFixed(2)
              .replace('.', ',')}`,
            message: 'Ver detalhes no sistema Inexci.',
          },
        );
        break;
    }

    return { notified: true, template: dto.template, to };
  }

  // ============================================================
  // ENDPOINTS LEGADOS (mantidos para compatibilidade temporária)
  // ============================================================

  /**
   * @deprecated Use sendRequest() via POST /surgery-requests/:id/send
   */
  async send(data: any, userId: string) {
    return this.sendRequest(data.id, { method: 'download' }, userId);
  }

  /**
   * @deprecated Use closeSurgeryRequest() via POST /surgery-requests/:id/close
   */
  async cancel(data: any, userId: string) {
    return this.closeSurgeryRequest(data.id, { reason: data.reason }, userId);
  }

  async updateStatus(
    surgeryRequestId: string,
    newStatus: number,
    userId: string,
  ) {
    const request = await this.surgeryRequestRepository.findOneSimple({
      id: surgeryRequestId,
    });
    if (!request) throw new NotFoundException('Solicitação não encontrada');

    const validStatuses = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    if (!validStatuses.includes(newStatus)) {
      throw new BadRequestException(`Status inválido: ${newStatus}`);
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurgeryRequest);
      const statusUpdateRepo = manager.getRepository(StatusUpdate);
      await repo.update({ id: surgeryRequestId }, { status: newStatus });
      await statusUpdateRepo.save({
        surgery_request_id: surgeryRequestId,
        prev_status: request.status,
        new_status: newStatus,
      });
      const activityRepo = manager.getRepository(SurgeryRequestActivity);
      const prevLabel =
        this.statusLabels[request.status] ?? String(request.status);
      const newLabel = this.statusLabels[newStatus] ?? String(newStatus);
      await activityRepo.save({
        surgery_request_id: surgeryRequestId,
        user_id: userId,
        type: ActivityType.STATUS_CHANGE,
        content: `Status alterado de "${prevLabel}" para "${newLabel}"`,
      });
      return repo.findOne({ where: { id: surgeryRequestId } });
    });
  }

  async dateExpired() {
    const surgeryRequests = await this.surgeryRequestRepository.findMany(
      { status: SurgeryRequestStatus.IN_ANALYSIS },
      0,
      1000,
    );

    return surgeryRequests
      .map((sr) => {
        const createdAt = sr.status_updates?.[0]?.created_at;
        const days = calculateDaysDifference(createdAt);
        return { ...sr, daysDifference: days };
      })
      .filter(
        (sr) =>
          sr.daysDifference >= 21 && (!sr.date_call || !sr.hospital_protocol),
      );
  }

  // ============================================================
  // PDF DO LAUDO MÉDICO
  // ============================================================

  /**
   * GET /surgery-requests/:id/report-pdf
   * Gera o PDF do laudo médico da solicitação.
   */
  async generateReportPdf(id: string, userId: string): Promise<Buffer> {
    const request = await this.loadRequestWithRelations(id);

    // ── Parsear medical_report ─────────────────────────────────────────────
    let reportData: {
      patientData?: {
        name?: string;
        birthDate?: string;
        rg?: string;
        cpf?: string;
        phone?: string;
        address?: string;
        zipCode?: string;
        healthPlan?: string;
      };
      historyAndDiagnosis?: string;
      conduct?: string;
    } = {};
    try {
      if (request.medical_report) {
        reportData = JSON.parse(request.medical_report as unknown as string);
      }
    } catch {
      // fallback vazio
    }

    // ── Dados do médico com perfil ─────────────────────────────────────────
    const doctor = await this.userRepository.findOneWithProfile({ id: userId });
    const profile = (doctor as any)?.doctor_profile;

    // ── Imagens dos exames (signed URLs) ───────────────────────────────────
    const allDocs = (request as any).documents ?? [];
    this.logger.log(
      `[PDF] Total documents: ${allDocs.length} | keys: ${allDocs.map((d: any) => d.key).join(', ')}`,
    );
    const examDocs = allDocs.filter((d: any) => d.key === 'report_images');
    this.logger.log(
      `[PDF] examDocs count: ${examDocs.length} | uris: ${examDocs.map((d: any) => String(d.uri).substring(0, 80)).join(' | ')}`,
    );
    const examImages: string[] = (
      await Promise.all(
        examDocs.map(async (doc: any) => {
          const raw: string = doc.uri;
          if (!raw) return null;
          // Se já é URL completa (assinada pelo loadRequestWithRelations), usa direto
          if (raw.startsWith('http')) {
            this.logger.log(`[PDF] image already signed URL, using directly`);
            return raw;
          }
          // Path relativo → gerar signed URL
          try {
            const signed = await this.storageService.getSignedUrl(raw);
            this.logger.log(`[PDF] signed URL generated OK`);
            return signed;
          } catch (err: any) {
            this.logger.warn(
              `[PDF] getSignedUrl failed for "${raw}": ${err?.message}`,
            );
            return null;
          }
        }),
      )
    ).filter((u): u is string => !!u);
    this.logger.log(`[PDF] final examImages count: ${examImages.length}`);

    // ── Assinatura do médico (signed URL se for path) ──────────────────────
    let doctorSignatureUrl: string | undefined;
    if (profile?.signature_url) {
      try {
        // Tenta gerar signed URL (pode já ser URL completa)
        const raw: string = profile.signature_url;
        doctorSignatureUrl = raw.startsWith('http')
          ? raw
          : await this.storageService.getSignedUrl(raw);
      } catch {
        doctorSignatureUrl = profile.signature_url;
      }
    }

    // ── Dados do paciente (prioridade: medical_report > entidade patient) ──
    const pd = reportData.patientData ?? {};
    const patient = (request as any).patient;

    const pdfData: import('src/shared/pdf/pdf.service').MedicalReportPdfData = {
      today: new Date().toLocaleDateString('pt-BR'),
      patientName: pd.name || patient?.name || undefined,
      patientBirthDate:
        pd.birthDate ||
        (patient?.birth_date
          ? new Date(patient.birth_date).toLocaleDateString('pt-BR')
          : undefined),
      patientRg: pd.rg || patient?.rg || undefined,
      patientCpf: pd.cpf || patient?.cpf || undefined,
      patientPhone: pd.phone || patient?.phone || undefined,
      patientAddress: pd.address || patient?.address || undefined,
      patientZipCode:
        pd.zipCode || patient?.zip_code || patient?.cep || undefined,
      patientHealthPlan:
        pd.healthPlan || (request as any).health_plan?.name || undefined,
      historyAndDiagnosis: reportData.historyAndDiagnosis || undefined,
      conduct: reportData.conduct || undefined,
      examImages: examImages.length ? examImages : undefined,
      doctorName: doctor?.name ?? 'Médico',
      doctorCrm: profile?.crm || undefined,
      doctorCrmState: profile?.crm_state || undefined,
      doctorSpecialty: profile?.specialty || undefined,
      doctorSignatureUrl,
    };

    return this.pdfService.generateMedicalReportPdf(pdfData);
  }

  // ============================================================
  // TEMPLATES DE SOLICITAÇÃO
  // ============================================================

  /**
   * POST /surgery-requests/templates
   * Cria um template de solicitação cirúrgica para o médico logado.
   */
  async createTemplate(
    dto: { name: string; template_data: object },
    userId: string,
  ): Promise<any> {
    const templateRepo = this.dataSource.getRepository(
      (await import('src/database/entities/surgery-request-template.entity'))
        .SurgeryRequestTemplate,
    );
    const template = templateRepo.create({
      doctor_id: userId,
      name: dto.name,
      template_data: dto.template_data as any,
    });
    return templateRepo.save(template);
  }

  /**
   * GET /surgery-requests/templates
   * Lista os templates do médico logado.
   */
  async getTemplates(userId: string): Promise<any[]> {
    const templateRepo = this.dataSource.getRepository(
      (await import('src/database/entities/surgery-request-template.entity'))
        .SurgeryRequestTemplate,
    );
    return templateRepo.find({
      where: { doctor_id: userId },
      order: { created_at: 'DESC' },
    });
  }
}

function calculateDaysDifference(date: Date): number {
  if (!date) return 0;
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
