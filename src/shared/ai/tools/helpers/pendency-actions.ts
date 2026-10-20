export interface PendencyRecommendation {
  action: string;
  minParams: string[];
}

const UPDATE_SC_PATIENT_ACTION =
  'plan_actions(intent="update_sc") + draft_update(update_sc, surgeryRequestId, …) + draft_update(update_sc, scope, "patient") + draft_update(update_sc, changes, {…}) + update_sc_draft_commit';

const UPDATE_SC_PATIENT: PendencyRecommendation = {
  action: UPDATE_SC_PATIENT_ACTION,
  minParams: ['surgery_request_id_or_protocol', 'field', 'value'],
};

export function recommendActionForPendency(
  key: string,
  undoneItems: ReadonlyArray<{ label: string }> = [],
): PendencyRecommendation {
  const undoneLabels = new Set(
    undoneItems.map((i) => i.label.toLowerCase().trim()),
  );
  const hasUndone = (predicate: (label: string) => boolean) =>
    Array.from(undoneLabels).some(predicate);

  switch (key) {
    case 'patient_data':
      return UPDATE_SC_PATIENT;
    case 'hospital_data':
      return {
        action: 'set_hospital',
        minParams: ['surgeryRequestId', 'hospital_name'],
      };
    case 'tuss_procedures':
      return {
        action: 'manage_tuss_items(operation="add")',
        minParams: ['surgeryRequestId', 'tussCode ou name'],
      };
    case 'opme_items': {
      const onlyMissingFlag =
        undoneLabels.size === 1 &&
        hasUndone((l) => l.includes('indicar se há ou não opme'));
      if (onlyMissingFlag) {
        return {
          action: 'set_has_opme',
          minParams: ['surgeryRequestId', 'hasOpme=true|false'],
        };
      }
      return {
        action: 'manage_opme_items(operation="add") (ou set_has_opme=false)',
        minParams: [
          'surgeryRequestId',
          'name',
          'quantity',
          'manufacturerNames (3+)',
          'supplierNames (3+)',
        ],
      };
    }
    case 'medical_report': {
      const missingSignature = hasUndone((l) => l.includes('assinatura'));
      const missingSections = hasUndone((l) => l.includes('seção de laudo'));
      const missingPatient = hasUndone((l) =>
        ['nome do paciente', 'cpf'].includes(l),
      );

      if (missingSignature && !missingSections && !missingPatient) {
        return {
          action: 'upload_doctor_signature',
          minParams: [
            'imagem da assinatura enviada pelo WhatsApp do MÉDICO',
            'confirm=true',
          ],
        };
      }
      if (missingPatient && !missingSections && !missingSignature) {
        return UPDATE_SC_PATIENT;
      }
      if (!missingPatient && !missingSignature) {
        return {
          action: 'manage_report_sections',
          minParams: ['surgeryRequestId', 'operation=create', 'title'],
        };
      }
      const actions: string[] = [];
      if (missingPatient) {
        actions.push(
          'completar dados do paciente via plan_actions(intent="update_sc") + draft_update',
        );
      }
      if (missingSections) actions.push('manage_report_sections');
      if (missingSignature) actions.push('upload_doctor_signature');
      return {
        action: actions.join(' + '),
        minParams: ['surgeryRequestId', 'ver sub-itens pendentes acima'],
      };
    }
    case 'schedule_dates':
      return {
        action:
          'plan_actions(intent="scheduling") + draft_update(scheduling, surgeryRequestId, …) + draft_update(scheduling, dateOptions, [...]) + scheduling_draft_commit',
        minParams: ['surgery_request_id_or_protocol', 'date_options[]'],
      };
    case 'confirm_date':
      return {
        action:
          'plan_actions(intent="scheduling") + draft_update(scheduling, surgeryRequestId, …) + draft_update(scheduling, confirmedDateIndex, …) + scheduling_draft_commit',
        minParams: ['surgery_request_id_or_protocol', 'confirmed_date_index'],
      };
    case 'confirm_receipt':
      return {
        action: 'confirm_receipt',
        minParams: ['surgeryRequestId', 'receivedValue', 'receivedAt'],
      };
    default:
      if (key.startsWith('doc_')) {
        return {
          action: 'attach_document_from_whatsapp',
          minParams: ['surgeryRequestId', 'document_type?', 'confirm=true'],
        };
      }
      return {
        action: 'get_pendencies',
        minParams: ['surgeryRequestId'],
      };
  }
}
