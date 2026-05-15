export const CREATE_PATIENT_MODULE = `SUB-DRAFT: create_patient.
- Campos típicos: name, phone, email, cpf, birthDate, gender. Use draft_update por campo.
- Ao commitar, o draft pai (ex.: create_sc) é retomado e o patientId é preenchido automaticamente.`;

export const CREATE_HOSPITAL_MODULE = `SUB-DRAFT: create_hospital.
- Campos típicos: name, cnpj, phone, address.`;

export const CREATE_HEALTH_PLAN_MODULE = `SUB-DRAFT: create_health_plan.
- Campo principal: name (e variantes informadas pelo usuário).`;

export const CREATE_PROCEDURE_MODULE = `SUB-DRAFT: create_procedure.
- Campos típicos: name, doctorId.`;
