import { AiTool } from '../tool.interface';
import { SurgeryRequestRepository } from '../../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../../database/repositories/surgery-request-activity.repository';
import { SurgeryRequestWorkflowService } from '../../../../modules/surgery-requests/services/surgery-request-workflow.service';
import { SurgeryRequestsService } from '../../../../modules/surgery-requests/surgery-requests.service';
import { PatientRepository } from '../../../../database/repositories/patient.repository';
import { HospitalRepository } from '../../../../database/repositories/hospital.repository';
import { HealthPlanRepository } from '../../../../database/repositories/health-plan.repository';
import { ProcedureRepository } from '../../../../database/repositories/procedure.repository';
import { UserRepository } from '../../../../database/repositories/user.repository';
import { PendencyValidatorService } from '../../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { TussService } from '../../../../modules/tuss/tuss.service';
import { EntityResolverService } from '../../services/entity-resolver.service';
import { PatientsService } from '../../../../modules/patients/patients.service';
import { WhatsappFlowDocumentDeps, WhatsappFlowToolDeps } from './_types';
import { buildRescheduleSurgeryTool } from './reschedule-surgery.tool';
import { buildConfirmReceiptTool } from './confirm-receipt.tool';
import { buildUpdateReceiptTool } from './update-receipt.tool';
import { buildManageReportSectionsTool } from './manage-report-sections.tool';
import { buildSetHospitalTool } from './set-hospital.tool';
import { buildListScCreationCatalogTool } from './list-sc-creation-catalog.tool';
import { buildAttachDocumentFromWhatsappTool } from './attach-document-from-whatsapp.tool';
import { buildCreatePatientFromDocumentTool } from './create-patient-from-document.tool';

export function buildWhatsappFlowTools(
  surgeryRequestRepo: SurgeryRequestRepository,
  workflowService: SurgeryRequestWorkflowService,
  surgeryRequestsService: SurgeryRequestsService,
  activityRepo: SurgeryRequestActivityRepository,
  documentDeps: WhatsappFlowDocumentDeps,
  pendencyValidator?: PendencyValidatorService,
  patientRepo?: PatientRepository,
  hospitalRepo?: HospitalRepository,
  healthPlanRepo?: HealthPlanRepository,
  procedureRepo?: ProcedureRepository,
  userRepo?: UserRepository,
  tussService?: TussService,
  entityResolver?: EntityResolverService,
  patientsService?: PatientsService,
): AiTool[] {
  const deps: WhatsappFlowToolDeps = {
    surgeryRequestRepo,
    workflowService,
    surgeryRequestsService,
    activityRepo,
    pendencyValidator,
    patientRepo,
    hospitalRepo,
    healthPlanRepo,
    procedureRepo,
    userRepo,
    tussService,
    entityResolver,
    documentDeps,
    patientsService,
  };
  return [
    buildListScCreationCatalogTool(deps),
    buildRescheduleSurgeryTool(deps),
    buildConfirmReceiptTool(deps),
    buildUpdateReceiptTool(deps),
    buildManageReportSectionsTool(deps),
    buildSetHospitalTool(deps),
    buildAttachDocumentFromWhatsappTool(deps),
    buildCreatePatientFromDocumentTool(deps),
  ];
}
