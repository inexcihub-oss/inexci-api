export default {
  // Fase Pendente (Status 1)
  patientData: 'patient_data',
  hospitalData: 'hospital_data',
  healthPlanData: 'health_plan_data',
  insertTuss: 'insert_tuss',
  insertOpme: 'insert_opme',
  diagnosisData: 'diagnosis_data',
  medicalReport: 'medical_report',

  // Fase Enviada (Status 2)
  quotation1: 'quotation_1',
  quotation2: 'quotation_2',
  quotation3: 'quotation_3',
  hospitalProtocol: 'hospital_protocol',
  healthPlanProtocol: 'health_plan_protocol',

  // Fase Em Análise (Status 3)
  waitAnalysis: 'wait_analysis',

  // Fase Em Agendamento (Status 4)
  defineDates: 'define_dates',
  patientChooseDate: 'patient_choose_date',

  // Fase Agendada (Status 5)
  confirmSurgery: 'confirm_surgery',

  // Fase Realizada (Status 6)
  surgeryDescription: 'surgery_description',
  invoicedValue: 'invoiced_value',

  // Fase Faturada (Status 7)
  registerReceipt: 'register_receipt',

  // Documentos (usados em várias fases)
  documents: {
    personalDocument: 'document_personal_document',
    doctorRequest: 'document_doctor_request',
    rnmReport: 'document_rnm_report',
    authorizationGuide: 'document_authorization_guide',
    additionalDocument: 'document_additional_document',
    invoiceProtocol: 'document_invoice_protocol',
  },

  // Chaves legadas (mantidas para compatibilidade)
  completeFields: 'complete_fields',
  selectSuppliers: 'select_suppliers',
  insertQuotations: 'insert_quotations',
};
