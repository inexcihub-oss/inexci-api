import { OperationDraftService } from '../../services/operation-draft.service';
import { UserRepository } from '../../../../database/repositories/user.repository';
import { SurgeryRequestActivityRepository } from '../../../../database/repositories/surgery-request-activity.repository';
import { SurgeryRequestsService } from '../../../../modules/surgery-requests/surgery-requests.service';
import { SurgeryRequestRepository } from '../../../../database/repositories/surgery-request.repository';
import { OpmeService } from '../../../../modules/surgery-requests/opme/opme.service';
import { TussService } from '../../../../modules/tuss/tuss.service';

/**
 * Dependências mínimas das tools `sc_draft_preview` e `sc_draft_commit`.
 * Setters per-type (`sc_draft_set_*`) e tools de status/cancel foram
 * removidos na Fase 5 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md` em favor
 * das tools globais `draft_update`, `draft_status` e `draft_cancel`.
 *
 * `opmeService` e `tussService` são opcionais e usados apenas pelo
 * `sc_draft_commit` quando o draft trouxer `notes`, `tussItems` ou
 * `opmeItems` (tipicamente populados pelo classificador de documentos).
 */
export interface ScDraftToolDeps {
  draftService: OperationDraftService;
  userRepo: UserRepository;
  surgeryRequestRepo: SurgeryRequestRepository;
  surgeryRequestsService: SurgeryRequestsService;
  activityRepo: SurgeryRequestActivityRepository;
  opmeService?: OpmeService;
  tussService?: TussService;
}
