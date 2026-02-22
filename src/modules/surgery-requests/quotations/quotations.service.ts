import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { SupplierRepository } from 'src/database/repositories/supplier.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { UserRole } from 'src/database/entities/user.entity';
import { SurgeryRequestQuotationRepository } from 'src/database/repositories/surgery-request-quotation.repository';
import { SurgeryRequestsService } from '../surgery-requests.service';
import { ChatsService } from '../chats/chats.service';
import { EmailService } from 'src/shared/email/email.service';
import { DataSource, IsNull, Not } from 'typeorm';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { SurgeryRequestQuotation } from 'src/database/entities/surgery-request-quotation.entity';
import { Chat } from 'src/database/entities/chat.entity';
import { StatusUpdate } from 'src/database/entities/status-update.entity';
import { Supplier } from 'src/database/entities/supplier.entity';

@Injectable()
export class QuotationsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly chatsService: ChatsService,
    private readonly emailService: EmailService,
    private readonly userRepository: UserRepository,
    private readonly supplierRepository: SupplierRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
    private readonly surgeryRequestsService: SurgeryRequestsService,
    private readonly surgeryRequestQuotationRepository: SurgeryRequestQuotationRepository,
  ) {}

  private async getDoctorId(userId: string): Promise<string | null> {
    const user = await this.userRepository.findOne({ id: userId });

    if (user.role === UserRole.DOCTOR) {
      // supplier.doctor_id → user.id (FK para user, não para doctor_profile)
      return userId;
    }

    // TODO: Para colaboradores, obter via TeamMember
    return null;
  }

  async create(data: CreateQuotationDto, userId: string) {
    const surgeryRequest = await this.surgeryRequestsService.findOne(
      data.surgery_request_id,
      userId,
    );

    const doctorId = await this.getDoctorId(userId);
    let supplierId = null;

    // Buscar fornecedor pelo email
    const supplier = await this.supplierRepository.findOne({
      email: data.supplier.email,
    });

    if (supplier) {
      supplierId = supplier.id;
    } else {
      // Criar novo fornecedor específico do médico
      const supplierRepo = this.dataSource.getRepository(Supplier);
      const newSupplier = await supplierRepo.save({
        email: data.supplier.email,
        name: data.supplier.name,
        phone: data.supplier.phone,
        doctor_id: doctorId,
      });
      supplierId = newSupplier.id;
    }

    const quotation = await this.surgeryRequestQuotationRepository.findOne({
      supplier_id: supplierId,
      surgery_request_id: data.surgery_request_id,
    });
    if (quotation)
      throw new NotFoundException(
        'A quotation for this supplier already exists',
      );

    return await this.dataSource.transaction(async (manager) => {
      const quotationRepo = manager.getRepository(SurgeryRequestQuotation);
      const chatRepo = manager.getRepository(Chat);

      const newQuotation = await quotationRepo.save({
        supplier_id: supplierId,
        surgery_request_id: data.surgery_request_id,
      });

      // Chat para fornecedor - associado ao userId (não ao supplier_id)
      // Na nova arquitetura, fornecedores não fazem login, então comentamos isso
      // Chats são entre usuários logados (médicos/colaboradores)

      return newQuotation;
    });
  }

  async update(data: UpdateQuotationDto, userId: string) {
    const quotation = await this.surgeryRequestQuotationRepository.findOne({
      id: data.surgery_request_quotation_id,
    });
    if (!quotation) throw new NotFoundException('Quotation not found');

    const surgeryRequest = await this.surgeryRequestsService.findOneSimple(
      quotation.surgery_request_id,
      userId,
    );

    return await this.dataSource.transaction(async (manager) => {
      const quotationRepo = manager.getRepository(SurgeryRequestQuotation);
      const statusUpdateRepo = manager.getRepository(StatusUpdate);
      const surgeryRequestRepo = manager.getRepository(SurgeryRequest);

      const updated = await quotationRepo.update(
        { id: data.surgery_request_quotation_id },
        {
          proposal_number: data.proposal_number,
          submission_date: data.submission_date,
        },
      );

      const quotations = await quotationRepo.find({
        where: {
          surgery_request_id: surgeryRequest.id,
          submission_date: Not(IsNull()),
        },
      });

      // Quando há 3+ cotações com data de submissão, muda para Em Análise
      if (quotations.length >= 3) {
        await Promise.all([
          statusUpdateRepo.save({
            surgery_request_id: surgeryRequest.id,
            prev_status: surgeryRequest.status,
            new_status: SurgeryRequestStatus.IN_ANALYSIS,
          }),
          surgeryRequestRepo.update(
            { id: surgeryRequest.id },
            { status: SurgeryRequestStatus.IN_ANALYSIS },
          ),
        ]);
      }

      return updated;
    });
  }
}
