import { OperationDraftService } from '../../services/operation-draft.service';
import { PatientRepository } from '../../../../database/repositories/patient.repository';
import { ProcedureRepository } from '../../../../database/repositories/procedure.repository';
import { UserRepository } from '../../../../database/repositories/user.repository';
import { PatientsService } from '../../../../modules/patients/patients.service';
import { HospitalsService } from '../../../../modules/hospitals/hospitals.service';
import { HealthPlansService } from '../../../../modules/health-plans/health-plans.service';
import { ProceduresService } from '../../../../modules/procedures/procedures.service';

export interface CadastroDraftDeps {
  draftService: OperationDraftService;
  patientRepo: PatientRepository;
  procedureRepo: ProcedureRepository;
  userRepo: UserRepository;
  patientsService: PatientsService;
  hospitalsService: HospitalsService;
  healthPlansService: HealthPlansService;
  proceduresService: ProceduresService;
}
