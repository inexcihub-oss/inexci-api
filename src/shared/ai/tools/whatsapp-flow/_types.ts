import { SurgeryRequestRepository } from '../../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../../database/repositories/surgery-request-activity.repository';
import { WorkflowEngineService } from '../../services/workflow-engine.service';
import { SurgeryRequestsService } from '../../../../modules/surgery-requests/surgery-requests.service';
import { PatientRepository } from '../../../../database/repositories/patient.repository';
import { HospitalRepository } from '../../../../database/repositories/hospital.repository';
import { HealthPlanRepository } from '../../../../database/repositories/health-plan.repository';
import { ProcedureRepository } from '../../../../database/repositories/procedure.repository';
import { UserRepository } from '../../../../database/repositories/user.repository';
import { PendencyValidatorService } from '../../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { TussService } from '../../../../modules/tuss/tuss.service';
import { EntityResolverService } from '../../services/entity-resolver.service';
import { WhatsappDocumentDispatcherService } from '../../services/whatsapp-document-dispatcher.service';
import { StorageService } from '../../../storage/storage.service';
import { DocumentRepository } from '../../../../database/repositories/document.repository';
import { PatientsService } from '../../../../modules/patients/patients.service';
import { DocumentsService } from '../../../../modules/surgery-requests/documents/documents.service';

export interface WhatsappFlowDocumentDeps {
  documentDispatcher?: WhatsappDocumentDispatcherService;
  storageService?: StorageService;
  documentRepo?: DocumentRepository;
  documentsService: DocumentsService;
}

export interface WhatsappFlowToolDeps {
  surgeryRequestRepo: SurgeryRequestRepository;
  workflowService: WorkflowEngineService;
  surgeryRequestsService: SurgeryRequestsService;
  activityRepo: SurgeryRequestActivityRepository;
  pendencyValidator?: PendencyValidatorService;
  patientRepo?: PatientRepository;
  hospitalRepo?: HospitalRepository;
  healthPlanRepo?: HealthPlanRepository;
  procedureRepo?: ProcedureRepository;
  userRepo?: UserRepository;
  tussService?: TussService;
  entityResolver?: EntityResolverService;
  documentDeps: WhatsappFlowDocumentDeps;
  patientsService?: PatientsService;
}
