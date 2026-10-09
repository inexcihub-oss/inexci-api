import { OperationDraftService } from '../../services/operation-draft.service';
import { UserRepository } from '../../../../database/repositories/user.repository';
import { SurgeryRequestActivityRepository } from '../../../../database/repositories/surgery-request-activity.repository';
import { SurgeryRequestsService } from '../../../../modules/surgery-requests/surgery-requests.service';
import { SurgeryRequestRepository } from '../../../../database/repositories/surgery-request.repository';
import { SurgeryRequestAssemblyService } from '../../../../modules/surgery-requests/services/surgery-request-assembly.service';

export interface ScDraftToolDeps {
  draftService: OperationDraftService;
  userRepo: UserRepository;
  surgeryRequestRepo: SurgeryRequestRepository;
  surgeryRequestsService: SurgeryRequestsService;
  activityRepo: SurgeryRequestActivityRepository;
  assemblyService?: SurgeryRequestAssemblyService;
}
