import { AiTool } from '../tool.interface';
import { WhatsappFlowToolDeps } from './_types';
import { buildRescheduleSurgeryTool } from './reschedule-surgery.tool';
import { buildConfirmReceiptTool } from './confirm-receipt.tool';
import { buildUpdateReceiptTool } from './update-receipt.tool';
import { buildManageReportSectionsTool } from './manage-report-sections.tool';
import { buildSetHospitalTool } from './set-hospital.tool';
import { buildListScCreationCatalogTool } from './list-sc-creation-catalog.tool';
import { buildAttachDocumentFromWhatsappTool } from './attach-document-from-whatsapp.tool';
import { buildCreatePatientFromDocumentTool } from './create-patient-from-document.tool';

export type { WhatsappFlowToolDeps } from './_types';

export function buildWhatsappFlowTools(deps: WhatsappFlowToolDeps): AiTool[] {
  return [
    buildListScCreationCatalogTool(deps),
    buildRescheduleSurgeryTool(deps),
    buildConfirmReceiptTool(deps),
    buildUpdateReceiptTool(deps),
    buildManageReportSectionsTool(deps),
    buildSetHospitalTool(deps),
    buildAttachDocumentFromWhatsappTool(deps),
    buildCreatePatientFromDocumentTool(deps),
  ];
}
