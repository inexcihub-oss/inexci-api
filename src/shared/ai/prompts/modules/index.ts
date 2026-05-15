import { OperationDraftType } from '../../drafts/operation-draft.types';
import { ACCEPT_AUTHORIZATION_MODULE } from './accept_authorization.module';
import {
  CREATE_HEALTH_PLAN_MODULE,
  CREATE_HOSPITAL_MODULE,
  CREATE_PATIENT_MODULE,
  CREATE_PROCEDURE_MODULE,
} from './cadastros.module';
import { CONTESTATION_MODULE } from './contestation.module';
import { CREATE_SC_MODULE } from './create_sc.module';
import { INVOICE_MODULE } from './invoice.module';
import { MARK_PERFORMED_MODULE } from './mark_performed.module';
import { MULTIMODAL_AUDIO_REVIEW_MODULE } from './multimodal_audio_review.module';
import { MULTIMODAL_DOC_REVIEW_MODULE } from './multimodal_doc_review.module';
import { SCHEDULING_MODULE } from './scheduling.module';
import { SEND_SC_MODULE } from './send_sc.module';
import { START_ANALYSIS_MODULE } from './start_analysis.module';
import { UPDATE_SC_MODULE } from './update_sc.module';

/**
 * Mapa imutável de `OperationDraftType` → módulo de prompt.
 * `null` (sem draft) não recebe nenhum módulo — só o core.
 */
export const WORKFLOW_MODULES: Readonly<Record<OperationDraftType, string>> = {
  create_sc: CREATE_SC_MODULE,
  send_sc: SEND_SC_MODULE,
  start_analysis: START_ANALYSIS_MODULE,
  accept_authorization: ACCEPT_AUTHORIZATION_MODULE,
  mark_performed: MARK_PERFORMED_MODULE,
  scheduling: SCHEDULING_MODULE,
  invoice: INVOICE_MODULE,
  contestation: CONTESTATION_MODULE,
  update_sc: UPDATE_SC_MODULE,
  create_patient: CREATE_PATIENT_MODULE,
  create_hospital: CREATE_HOSPITAL_MODULE,
  create_health_plan: CREATE_HEALTH_PLAN_MODULE,
  create_procedure: CREATE_PROCEDURE_MODULE,
};

export { MULTIMODAL_DOC_REVIEW_MODULE, MULTIMODAL_AUDIO_REVIEW_MODULE };
