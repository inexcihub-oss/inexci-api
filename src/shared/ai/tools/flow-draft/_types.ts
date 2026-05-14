import { OperationDraftService } from '../../services/operation-draft.service';
import { SurgeryRequestRepository } from '../../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../../database/repositories/surgery-request-activity.repository';
import { SurgeryRequestWorkflowService } from '../../../../modules/surgery-requests/services/surgery-request-workflow.service';
import { PatientsService } from '../../../../modules/patients/patients.service';
import { SurgeryRequestsService } from '../../../../modules/surgery-requests/surgery-requests.service';

export interface FlowDraftDeps {
  draftService: OperationDraftService;
  surgeryRequestRepo: SurgeryRequestRepository;
  workflowService: SurgeryRequestWorkflowService;
  activityRepo: SurgeryRequestActivityRepository;
  patientsService: PatientsService;
  surgeryRequestsService: SurgeryRequestsService;
}
