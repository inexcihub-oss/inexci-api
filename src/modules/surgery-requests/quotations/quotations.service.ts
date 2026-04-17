import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { SupplierRepository } from 'src/database/repositories/supplier.repository';
import { SurgeryRequestQuotationRepository } from 'src/database/repositories/surgery-request-quotation.repository';
import { ChatsService } from '../chats/chats.service';
import { SurgeryRequestAccessValidator } from 'src/shared/services/surgery-request-access.validator';
import { BUSINESS_RULES } from 'src/shared/constants/business-rules';
import { DataSource, IsNull, Not } from 'typeorm';
import { executeInTransaction } from 'src/shared/utils/transaction.util';
import {
  SurgeryRequest,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { SurgeryRequestQuotation } from 'src/database/entities/surgery-request-quotation.entity';
import { StatusUpdate } from 'src/database/entities/status-update.entity';
import { Supplier } from 'src/database/entities/supplier.entity';
import { AccessControlService } from 'src/shared/services/access-control.service';

@Injectable()
export class QuotationsService {
  private readonly logger = new Logger(QuotationsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly chatsService: ChatsService,
    private readonly supplierRepository: SupplierRepository,
    private readonly accessControlService: AccessControlService,
    private readonly surgeryRequestAccessValidator: SurgeryRequestAccessValidator,
    private readonly surgeryRequestQuotationRepository: SurgeryRequestQuotationRepository,
  ) {}

  async create(data: CreateQuotationDto, userId: string) {
    await this.surgeryRequestAccessValidator.validateAndFetch(
      data.surgery_request_id,
      userId,
    );

    const doctorIds =
      await this.accessControlService.getAccessibleDoctorIds(userId);
    const doctorId = doctorIds.length ? doctorIds[0] : null;
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

    return await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const quotationRepo = manager.getRepository(SurgeryRequestQuotation);

        const newQuotation = await quotationRepo.save({
          supplier_id: supplierId,
          surgery_request_id: data.surgery_request_id,
        });

        return newQuotation;
      },
      { logger: this.logger, operationName: 'createQuotation' },
    );
  }

  async update(data: UpdateQuotationDto, userId: string) {
    const quotation = await this.surgeryRequestQuotationRepository.findOne({
      id: data.surgery_request_quotation_id,
    });
    if (!quotation) throw new NotFoundException('Quotation not found');

    const surgeryRequest =
      await this.surgeryRequestAccessValidator.validateAndFetch(
        quotation.surgery_request_id,
        userId,
      );

    return await executeInTransaction(
      this.dataSource,
      async (manager) => {
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

        // Quando há cotações suficientes com data de submissão, muda para Em Análise
        if (quotations.length >= BUSINESS_RULES.MIN_QUOTATIONS_FOR_ANALYSIS) {
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
      },
      { logger: this.logger, operationName: 'updateQuotation' },
    );
  }
}
