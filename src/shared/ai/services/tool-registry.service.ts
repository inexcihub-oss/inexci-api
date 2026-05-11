import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { AiTool, ToolContext } from '../tools/tool.interface';
import { buildSurgeryRequestTools } from '../tools/surgery-request.tools';
import { buildPendencyTools } from '../tools/pendency.tools';
import { buildGeneralTools } from '../tools/general.tools';
import { buildActionTools } from '../tools/action.tools';
import { buildNotificationTools } from '../tools/notification.tools';
import { buildWhatsappFlowTools } from '../tools/whatsapp-flow.tools';
import { buildManageTools } from '../tools/manage.tools';
import { buildDoctorProfileTools } from '../tools/doctor-profile.tools';
import { buildCatalogTools } from '../tools/catalog.tools';
import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../database/repositories/surgery-request-activity.repository';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { PatientRepository } from '../../../database/repositories/patient.repository';
import { HospitalRepository } from '../../../database/repositories/hospital.repository';
import { SurgeryRequestWorkflowService } from '../../../modules/surgery-requests/services/surgery-request-workflow.service';
import { SurgeryRequestMutationService } from '../../../modules/surgery-requests/services/surgery-request-mutation.service';
import { SurgeryRequestNotificationService } from '../../../modules/surgery-requests/services/surgery-request-notification.service';
import { SurgeryRequestsService } from '../../../modules/surgery-requests/surgery-requests.service';
import { SurgeryRequestTussItemRepository } from '../../../database/repositories/surgery-request-tuss-item.repository';
import { OpmeItemRepository } from '../../../database/repositories/opme-item.repository';
import { DocumentRepository } from '../../../database/repositories/document.repository';
import { HealthPlanRepository } from '../../../database/repositories/health-plan.repository';
import { ProcedureRepository } from '../../../database/repositories/procedure.repository';
import { UserRepository } from '../../../database/repositories/user.repository';
import { DoctorProfileRepository } from '../../../database/repositories/doctor-profile.repository';
import { SupplierRepository } from '../../../database/repositories/supplier.repository';
import { StorageService } from '../../storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { TussService } from '../../../modules/tuss/tuss.service';
import { EntityResolverService } from './entity-resolver.service';
import { OperationDraftService } from './operation-draft.service';
import { buildPlanTools } from '../tools/plan.tools';
import { buildScDraftTools } from '../tools/sc-draft.tools';
import { buildCadastroDraftTools } from '../tools/cadastro-draft.tools';
import { buildFlowDraftTools } from '../tools/flow-draft.tools';

@Injectable()
export class ToolRegistryService {
  private readonly tools = new Map<string, AiTool>();

  constructor(
    private readonly surgeryRequestRepo: SurgeryRequestRepository,
    private readonly activityRepo: SurgeryRequestActivityRepository,
    private readonly pendencyValidator: PendencyValidatorService,
    private readonly patientRepo: PatientRepository,
    private readonly hospitalRepo: HospitalRepository,
    private readonly workflowService: SurgeryRequestWorkflowService,
    private readonly mutationService: SurgeryRequestMutationService,
    private readonly notificationService: SurgeryRequestNotificationService,
    private readonly surgeryRequestsService: SurgeryRequestsService,
    private readonly tussItemRepo: SurgeryRequestTussItemRepository,
    private readonly opmeItemRepo: OpmeItemRepository,
    private readonly documentRepo: DocumentRepository,
    private readonly healthPlanRepo: HealthPlanRepository,
    private readonly procedureRepo: ProcedureRepository,
    private readonly userRepo: UserRepository,
    private readonly doctorProfileRepo: DoctorProfileRepository,
    private readonly supplierRepo: SupplierRepository,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    private readonly tussService: TussService,
    private readonly entityResolver: EntityResolverService,
    private readonly draftService: OperationDraftService,
  ) {
    this.registerAll();
  }

  private registerAll(): void {
    const allTools: AiTool[] = [
      ...buildPlanTools(this.draftService),
      ...buildScDraftTools({
        draftService: this.draftService,
        resolver: this.entityResolver,
        patientRepo: this.patientRepo,
        procedureRepo: this.procedureRepo,
        hospitalRepo: this.hospitalRepo,
        healthPlanRepo: this.healthPlanRepo,
        userRepo: this.userRepo,
        surgeryRequestRepo: this.surgeryRequestRepo,
        surgeryRequestsService: this.surgeryRequestsService,
        activityRepo: this.activityRepo,
      }),
      ...buildCadastroDraftTools({
        draftService: this.draftService,
        patientRepo: this.patientRepo,
        hospitalRepo: this.hospitalRepo,
        healthPlanRepo: this.healthPlanRepo,
        procedureRepo: this.procedureRepo,
        userRepo: this.userRepo,
      }),
      ...buildFlowDraftTools({
        draftService: this.draftService,
        surgeryRequestRepo: this.surgeryRequestRepo,
        workflowService: this.workflowService,
        activityRepo: this.activityRepo,
        patientRepo: this.patientRepo,
      }),
      ...buildSurgeryRequestTools(
        this.surgeryRequestRepo,
        this.pendencyValidator,
      ),
      ...buildPendencyTools(
        this.pendencyValidator,
        this.surgeryRequestRepo,
        this.documentRepo,
      ),
      ...buildDoctorProfileTools(
        this.userRepo,
        this.doctorProfileRepo,
        this.storageService,
        this.configService,
      ),
      ...buildGeneralTools(
        this.patientRepo,
        this.userRepo,
        this.entityResolver,
      ),
      ...buildCatalogTools(
        this.hospitalRepo,
        this.healthPlanRepo,
        this.procedureRepo,
        this.userRepo,
        this.entityResolver,
      ),
      ...buildActionTools(
        this.surgeryRequestRepo,
        this.workflowService,
        this.mutationService,
        this.pendencyValidator,
        this.activityRepo,
        this.patientRepo,
      ),
      ...buildNotificationTools(
        this.surgeryRequestRepo,
        this.notificationService,
        this.activityRepo,
      ),
      ...buildWhatsappFlowTools(
        this.surgeryRequestRepo,
        this.workflowService,
        this.surgeryRequestsService,
        this.activityRepo,
        this.pendencyValidator,
        this.patientRepo,
        this.hospitalRepo,
        this.healthPlanRepo,
        this.procedureRepo,
        this.userRepo,
        this.tussService,
        this.entityResolver,
      ),
      ...buildManageTools(
        this.surgeryRequestRepo,
        this.surgeryRequestsService,
        this.activityRepo,
        this.tussItemRepo,
        this.opmeItemRepo,
        this.documentRepo,
        this.supplierRepo,
        this.healthPlanRepo,
        this.storageService,
        this.configService,
        this.entityResolver,
      ),
    ];

    for (const tool of allTools) {
      this.tools.set(tool.name, tool);
    }
  }

  getToolDefinitions(): OpenAI.ChatCompletionTool[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  getTool(name: string): AiTool | undefined {
    return this.tools.get(name);
  }

  executeTool(
    name: string,
    args: Record<string, any>,
    context: ToolContext,
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return Promise.resolve(`Ferramenta "${name}" não encontrada.`);
    return tool.execute(args, context);
  }
}
