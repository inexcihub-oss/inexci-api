import { OperationDraftService } from '../../services/operation-draft.service';
import { SurgeryRequestRepository } from '../../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../../database/repositories/surgery-request-activity.repository';
import { DocumentRepository } from '../../../../database/repositories/document.repository';
import { SurgeryRequestWorkflowService } from '../../../../modules/surgery-requests/services/surgery-request-workflow.service';
import { PendencyValidatorService } from '../../../../modules/surgery-requests/pendencies/pendency-validator.service';

export interface FlowDraftTransitionDeps {
  draftService: OperationDraftService;
  surgeryRequestRepo: SurgeryRequestRepository;
  workflowService: SurgeryRequestWorkflowService;
  activityRepo: SurgeryRequestActivityRepository;
  documentRepo: DocumentRepository;
  pendencyValidator: PendencyValidatorService;
}
