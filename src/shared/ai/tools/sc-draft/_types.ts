import { OperationDraftService } from '../../services/operation-draft.service';
import { UserRepository } from '../../../../database/repositories/user.repository';
import { SurgeryRequestActivityRepository } from '../../../../database/repositories/surgery-request-activity.repository';
import { SurgeryRequestsService } from '../../../../modules/surgery-requests/surgery-requests.service';
import { SurgeryRequestRepository } from '../../../../database/repositories/surgery-request.repository';

/**
 * Dependências mínimas das tools `sc_draft_preview` e `sc_draft_commit`.
 * Setters per-type (`sc_draft_set_*`) e tools de status/cancel foram
 * removidos na Fase 5 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md` em favor
 * das tools globais `draft_update`, `draft_status` e `draft_cancel`.
 */
export interface ScDraftToolDeps {
  draftService: OperationDraftService;
  userRepo: UserRepository;
  surgeryRequestRepo: SurgeryRequestRepository;
  surgeryRequestsService: SurgeryRequestsService;
  activityRepo: SurgeryRequestActivityRepository;
}
