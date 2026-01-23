import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { UserRepository } from 'src/database/repositories/user.repository';
import { UserPvs, UserStatuses } from 'src/common';
import { SurgeryRequestQuotationRepository } from 'src/database/repositories/surgery-request-quotation.repository';
import { SurgeryRequestsService } from '../surgery-requests.service';
import { ChatsService } from '../chats/chats.service';
import { EmailService } from 'src/shared/email/email.service';
import { DataSource, IsNull, Not } from 'typeorm';
import surgeryRequestStatusesCommon from 'src/common/surgery-request-statuses.common';
import { SurgeryRequestQuotation } from 'src/database/entities/surgery-request-quotation.entity';
import { Chat } from 'src/database/entities/chat.entity';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { StatusUpdate } from 'src/database/entities/status-update.entity';

@Injectable()
export class QuotationsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly chatsService: ChatsService,
    private readonly emailService: EmailService,
    private readonly userRepository: UserRepository,
    private readonly surgeryRequestsService: SurgeryRequestsService,
    private readonly surgeryRequestQuotationRepository: SurgeryRequestQuotationRepository,
  ) {}

  async create(data: CreateQuotationDto, userId: number) {
    const surgeryRequest = await this.surgeryRequestsService.findOne(
      data.surgery_request_id,
      userId,
    );

    // if (!surgeryRequest.opme_items.length || !surgeryRequest.procedures.length)
    //   throw new BadRequestException(
    //     'Para inserir as cotações, a lista OPME e os procedimentos devem ser informados',
    //   );

    let supplierId = null;
    let shouldSendEmail = false;

    const supplier = await this.userRepository.findOne({
      email: data.supplier.email,
      profile: UserPvs.supplier,
    });

    if (supplier) {
      supplierId = supplier.id;
    } else {
      const newSupplier = await this.userRepository.create({
        profile: UserPvs.supplier,
        status: UserStatuses.incomplete,
        email: data.supplier.email,
        name: data.supplier.name,
        phone: data.supplier.phone,
      });
      supplierId = newSupplier.id;
      shouldSendEmail = true;
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

      if (shouldSendEmail) {
        this.emailService.sendCompleteRegisterEmail(data.supplier.email, {
          id: supplierId,
          name: data.supplier.name,
        });
      }

      const chat = await chatRepo.findOne({
        where: {
          user_id: supplierId,
          surgery_request_id: data.surgery_request_id,
        },
      });

      if (!chat) {
        await chatRepo.save({
          user_id: supplierId,
          surgery_request_id: data.surgery_request_id,
        });
      }

      return newQuotation;
    });
  }

  async update(data: UpdateQuotationDto, userId: number) {
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
        const statusData = surgeryRequestStatusesCommon.inAnalysis;

        await Promise.all([
          statusUpdateRepo.save({
            surgery_request_id: surgeryRequest.id,
            prev_status: surgeryRequest.status,
            new_status: statusData.value,
          }),
          surgeryRequestRepo.update(
            { id: surgeryRequest.id },
            { status: statusData.value },
          ),
        ]);
      }

      return updated;
    });
  }
}
