import { OperationDraftService } from '../../services/operation-draft.service';
import { SurgeryRequestRepository } from '../../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../../database/repositories/surgery-request-activity.repository';
import { DocumentRepository } from '../../../../database/repositories/document.repository';
import { WorkflowEngineService } from '../../services/workflow-engine.service';
import { PendencyValidatorService } from '../../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { StorageService } from '../../../storage/storage.service';

export interface FlowDraftTransitionDeps {
  draftService: OperationDraftService;
  surgeryRequestRepo: SurgeryRequestRepository;
  workflowService: WorkflowEngineService;
  activityRepo: SurgeryRequestActivityRepository;
  documentRepo: DocumentRepository;
  pendencyValidator: PendencyValidatorService;
  /**
   * Opcional. Necessário apenas para `send_sc_draft_commit` quando
   * `method=download`: faz upload temporário do PDF gerado no Supabase e
   * devolve uma signed URL para o usuário baixar via WhatsApp.
   */
  storageService?: StorageService;
}
