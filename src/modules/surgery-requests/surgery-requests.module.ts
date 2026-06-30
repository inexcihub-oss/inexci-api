import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DoctorHeader } from 'src/database/entities/doctor-header.entity';
import { DoctorHeaderRepository } from 'src/database/repositories/doctor-header.repository';
import { SurgeryRequest } from 'src/database/entities/surgery-request.entity';
import { SurgeryRequestAnalysis } from 'src/database/entities/surgery-request-analysis.entity';
import { SurgeryRequestBilling } from 'src/database/entities/surgery-request-billing.entity';
import { Contestation } from 'src/database/entities/contestation.entity';
import { SurgeryRequestTemplate } from 'src/database/entities/surgery-request-template.entity';
import { ReportSection } from 'src/database/entities/report-section.entity';
import { User } from 'src/database/entities/user.entity';
import { Patient } from 'src/database/entities/patient.entity';
import { Hospital } from 'src/database/entities/hospital.entity';
import { HealthPlan } from 'src/database/entities/health-plan.entity';
import { SurgeryRequestsService } from './surgery-requests.service';
import { SurgeryRequestWorkflowService } from './services/surgery-request-workflow.service';
import { SendAnalysisHandler } from './services/workflow/send-analysis.handler';
import { AuthorizationHandler } from './services/workflow/authorization.handler';
import { SchedulingHandler } from './services/workflow/scheduling.handler';
import { ExecutionHandler } from './services/workflow/execution.handler';
import { SurgeryRequestReportService } from './services/surgery-request-report.service';
import { SurgeryRequestTemplateService } from './services/surgery-request-template.service';
import { SurgeryRequestMutationService } from './services/surgery-request-mutation.service';
import { SurgeryRequestNotificationService } from './services/surgery-request-notification.service';
import { SurgeryRequestBillingService } from './services/surgery-request-billing.service';
import { SurgeryRequestAssemblyService } from './services/surgery-request-assembly.service';
import { DocumentEntityResolverService } from './services/document-entity-resolver.service';
import { SurgeryRequestFromDocumentService } from './services/surgery-request-from-document.service';
import { DoctorResolutionService } from 'src/shared/services/doctor-resolution.service';
import { SurgeryRequestsController } from './surgery-requests.controller';
import { UsersModule } from '../users/users.module';
import { PatientsModule } from '../patients/patients.module';
import { StorageService } from 'src/shared/storage/storage.service';
import { ActivitiesModule } from './activities/activities.module';
import { MailModule } from 'src/shared/mail/mail.module';
import { PdfModule } from 'src/shared/pdf/pdf.module';
import { PdfGenerationModule } from 'src/shared/pdf/pdf-generation.module';
import { QueuesModule } from 'src/shared/queues/queues.module';
import { PendenciesModule } from './pendencies/pendencies.module';
import { DocumentsModule } from './documents/documents.module';
import { OpmeModule } from './opme/opme.module';
import { WhatsappModule } from 'src/shared/whatsapp/whatsapp.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingModule } from '../billing/billing.module';
import { AiModule } from 'src/shared/ai/ai.module';
import { TussModule } from '../tuss/tuss.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SurgeryRequest,
      SurgeryRequestAnalysis,
      SurgeryRequestBilling,
      Contestation,
      SurgeryRequestTemplate,
      ReportSection,
      User,
      Patient,
      Hospital,
      HealthPlan,
      DoctorHeader,
    ]),
    UsersModule,
    PatientsModule,
    ActivitiesModule,
    MailModule,
    PdfModule,
    PdfGenerationModule,
    QueuesModule,
    PendenciesModule,
    DocumentsModule,
    OpmeModule,
    TussModule,
    WhatsappModule,
    NotificationsModule,
    BillingModule,
    forwardRef(() => AiModule),
  ],
  controllers: [SurgeryRequestsController],
  providers: [
    SurgeryRequestsService,
    SurgeryRequestMutationService,
    SurgeryRequestWorkflowService,
    SendAnalysisHandler,
    AuthorizationHandler,
    SchedulingHandler,
    ExecutionHandler,
    SurgeryRequestReportService,
    SurgeryRequestTemplateService,
    SurgeryRequestNotificationService,
    SurgeryRequestBillingService,
    SurgeryRequestAssemblyService,
    DocumentEntityResolverService,
    SurgeryRequestFromDocumentService,
    DoctorResolutionService,
    StorageService,
    DoctorHeaderRepository,
  ],
  exports: [
    SurgeryRequestsService,
    SurgeryRequestWorkflowService,
    SurgeryRequestMutationService,
    SurgeryRequestNotificationService,
    SurgeryRequestAssemblyService,
  ],
})
export class SurgeryRequestsModule {}
