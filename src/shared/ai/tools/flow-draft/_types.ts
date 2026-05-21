import { OperationDraftService } from '../../services/operation-draft.service';
import { SurgeryRequestRepository } from '../../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../../database/repositories/surgery-request-activity.repository';
import { WorkflowEngineService } from '../../services/workflow-engine.service';
import { PatientsService } from '../../../../modules/patients/patients.service';
import { SurgeryRequestsService } from '../../../../modules/surgery-requests/surgery-requests.service';

export interface FlowDraftDeps {
  draftService: OperationDraftService;
  surgeryRequestRepo: SurgeryRequestRepository;
  workflowService: WorkflowEngineService;
  activityRepo: SurgeryRequestActivityRepository;
  patientsService: PatientsService;
  surgeryRequestsService: SurgeryRequestsService;
}
