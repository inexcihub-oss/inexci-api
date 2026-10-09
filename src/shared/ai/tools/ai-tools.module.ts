import { ConfigService } from '@nestjs/config';
import { InjectionToken } from '@nestjs/common';

import { AiTool } from './tool.interface';
import { OperationDraftService } from '../services/operation-draft.service';
import { EntityResolverService } from '../services/entity-resolver.service';
import { WhatsappDocumentDispatcherService } from '../services/whatsapp-document-dispatcher.service';
import { ConversationMemoryService } from '../services/orchestrator/conversation-memory.service';

import { SurgeryRequestRepository } from '../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../database/repositories/surgery-request-activity.repository';
import { SurgeryRequestTussItemRepository } from '../../../database/repositories/surgery-request-tuss-item.repository';
import { OpmeItemRepository } from '../../../database/repositories/opme-item.repository';
import { DocumentRepository } from '../../../database/repositories/document.repository';
import { PatientRepository } from '../../../database/repositories/patient.repository';
import { HospitalRepository } from '../../../database/repositories/hospital.repository';
import { HealthPlanRepository } from '../../../database/repositories/health-plan.repository';
import { ProcedureRepository } from '../../../database/repositories/procedure.repository';
import { UserRepository } from '../../../database/repositories/user.repository';
import { DoctorProfileRepository } from '../../../database/repositories/doctor-profile.repository';
import { SupplierRepository } from '../../../database/repositories/supplier.repository';

import { SurgeryRequestsService } from '../../../modules/surgery-requests/surgery-requests.service';
import { SurgeryRequestWorkflowService } from '../../../modules/surgery-requests/services/surgery-request-workflow.service';
import { SurgeryRequestMutationService } from '../../../modules/surgery-requests/services/surgery-request-mutation.service';
import { SurgeryRequestNotificationService } from '../../../modules/surgery-requests/services/surgery-request-notification.service';
import { PendencyValidatorService } from '../../../modules/surgery-requests/pendencies/pendency-validator.service';
import { PatientsService } from '../../../modules/patients/patients.service';
import { HospitalsService } from '../../../modules/hospitals/hospitals.service';
import { HealthPlansService } from '../../../modules/health-plans/health-plans.service';
import { ProceduresService } from '../../../modules/procedures/procedures.service';
import { OpmeService } from '../../../modules/surgery-requests/opme/opme.service';
import { UsersService } from '../../../modules/users/users.service';
import { DocumentsService } from '../../../modules/surgery-requests/documents/documents.service';
import { TussService } from '../../../modules/tuss/tuss.service';
import { SurgeryRequestAssemblyService } from '../../../modules/surgery-requests/services/surgery-request-assembly.service';
import { CidService } from '../../../modules/surgery-requests/cid/cid.service';
import { StorageService } from '../../storage/storage.service';

import { buildPlanTools } from './plan.tools';
import { buildScDraftTools } from './sc-draft.tools';
import { buildCadastroDraftTools } from './cadastro-draft.tools';
import { buildFlowDraftTools } from './flow-draft.tools';
import { buildFlowDraftTransitionTools } from './flow-draft-transition.tools';
import { buildSurgeryRequestTools } from './surgery-request.tools';
import { buildPendencyTools } from './pendency.tools';
import { buildDoctorProfileTools } from './doctor-profile.tools';
import { buildGeneralTools } from './general.tools';
import { buildCatalogTools } from './catalog.tools';
import { buildTussTools } from './tuss.tools';
import { buildCidTools } from './cid.tools';
import { buildActionTools } from './action.tools';
import { buildNotificationTools } from './notification.tools';
import { buildWhatsappFlowTools } from './whatsapp-flow.tools';
import { buildManageTools } from './manage.tools';
import { buildDraftGenericTools } from './draft-generic.tools';

export interface AllToolsDeps {
  draftService: OperationDraftService;
  userRepo: UserRepository;
  surgeryRequestRepo: SurgeryRequestRepository;
  surgeryRequestsService: SurgeryRequestsService;
  activityRepo: SurgeryRequestActivityRepository;
  patientRepo: PatientRepository;
  procedureRepo: ProcedureRepository;
  patientsService: PatientsService;
  hospitalsService: HospitalsService;
  healthPlansService: HealthPlansService;
  proceduresService: ProceduresService;
  workflowService: SurgeryRequestWorkflowService;
  documentRepo: DocumentRepository;
  pendencyValidator: PendencyValidatorService;
  doctorProfileRepo: DoctorProfileRepository;
  storageService: StorageService;
  configService: ConfigService;
  usersService: UsersService;
  entityResolver: EntityResolverService;
  hospitalRepo: HospitalRepository;
  healthPlanRepo: HealthPlanRepository;
  tussService: TussService;
  cidService: CidService;
  mutationService: SurgeryRequestMutationService;
  notificationService: SurgeryRequestNotificationService;
  tussItemRepo: SurgeryRequestTussItemRepository;
  opmeItemRepo: OpmeItemRepository;
  supplierRepo: SupplierRepository;
  opmeService: OpmeService;
  documentsService: DocumentsService;
  documentDispatcher: WhatsappDocumentDispatcherService;
  conversationMemory: ConversationMemoryService;
  assemblyService: SurgeryRequestAssemblyService;
}

export function buildAllAiTools(deps: AllToolsDeps): AiTool[] {
  const {
    draftService,
    userRepo,
    surgeryRequestRepo,
    surgeryRequestsService,
    activityRepo,
    patientRepo,
    procedureRepo,
    patientsService,
    hospitalsService,
    healthPlansService,
    proceduresService,
    workflowService,
    documentRepo,
    pendencyValidator,
    doctorProfileRepo,
    storageService,
    configService,
    usersService,
    entityResolver,
    hospitalRepo,
    healthPlanRepo,
    tussService,
    cidService,
    mutationService,
    notificationService,
    tussItemRepo,
    opmeItemRepo,
    supplierRepo,
    opmeService,
    documentsService,
    documentDispatcher,
    conversationMemory,
    assemblyService,
  } = deps;

  return [
    ...buildPlanTools(draftService),
    ...buildScDraftTools({
      draftService,
      userRepo,
      surgeryRequestRepo,
      surgeryRequestsService,
      activityRepo,
      assemblyService,
    }),
    ...buildCadastroDraftTools({
      draftService,
      patientRepo,
      procedureRepo,
      userRepo,
      patientsService,
      hospitalsService,
      healthPlansService,
      proceduresService,
    }),
    ...buildFlowDraftTools({
      draftService,
      surgeryRequestRepo,
      workflowService,
      activityRepo,
      patientsService,
      surgeryRequestsService,
    }),
    ...buildFlowDraftTransitionTools({
      draftService,
      surgeryRequestRepo,
      workflowService,
      activityRepo,
      documentRepo,
      pendencyValidator,
      storageService,
    }),
    ...buildSurgeryRequestTools(surgeryRequestRepo, pendencyValidator),
    ...buildPendencyTools(pendencyValidator, surgeryRequestRepo, documentRepo),
    ...buildDoctorProfileTools(
      userRepo,
      doctorProfileRepo,
      storageService,
      configService,
      usersService,
      documentDispatcher,
      conversationMemory,
    ),
    ...buildGeneralTools(patientsService, entityResolver),
    ...buildCatalogTools(procedureRepo, entityResolver),
    ...buildTussTools(tussService),
    ...buildCidTools(cidService),
    ...buildActionTools(
      surgeryRequestRepo,
      workflowService,
      mutationService,
      pendencyValidator,
      activityRepo,
    ),
    ...buildNotificationTools(
      surgeryRequestRepo,
      notificationService,
      activityRepo,
    ),
    ...buildWhatsappFlowTools(
      surgeryRequestRepo,
      workflowService,
      surgeryRequestsService,
      activityRepo,
      {
        documentDispatcher,
        storageService,
        documentRepo,
        documentsService,
      },
      pendencyValidator,
      patientRepo,
      hospitalRepo,
      healthPlanRepo,
      procedureRepo,
      userRepo,
      tussService,
      entityResolver,
      patientsService,
    ),
    ...buildManageTools(
      surgeryRequestRepo,
      surgeryRequestsService,
      activityRepo,
      tussItemRepo,
      opmeItemRepo,
      documentRepo,
      supplierRepo,
      healthPlanRepo,
      storageService,
      configService,
      opmeService,
      documentsService,
      entityResolver,
      tussService,
    ),
    ...buildDraftGenericTools({ draftService, surgeryRequestRepo }),
  ];
}

export function aiToolsFactory(
  draftService: OperationDraftService,
  userRepo: UserRepository,
  surgeryRequestRepo: SurgeryRequestRepository,
  surgeryRequestsService: SurgeryRequestsService,
  activityRepo: SurgeryRequestActivityRepository,
  patientRepo: PatientRepository,
  procedureRepo: ProcedureRepository,
  patientsService: PatientsService,
  hospitalsService: HospitalsService,
  healthPlansService: HealthPlansService,
  proceduresService: ProceduresService,
  workflowService: SurgeryRequestWorkflowService,
  documentRepo: DocumentRepository,
  pendencyValidator: PendencyValidatorService,
  doctorProfileRepo: DoctorProfileRepository,
  storageService: StorageService,
  configService: ConfigService,
  usersService: UsersService,
  entityResolver: EntityResolverService,
  hospitalRepo: HospitalRepository,
  healthPlanRepo: HealthPlanRepository,
  tussService: TussService,
  cidService: CidService,
  mutationService: SurgeryRequestMutationService,
  notificationService: SurgeryRequestNotificationService,
  tussItemRepo: SurgeryRequestTussItemRepository,
  opmeItemRepo: OpmeItemRepository,
  supplierRepo: SupplierRepository,
  opmeService: OpmeService,
  documentsService: DocumentsService,
  documentDispatcher: WhatsappDocumentDispatcherService,
  conversationMemory: ConversationMemoryService,
  assemblyService: SurgeryRequestAssemblyService,
): AiTool[] {
  return buildAllAiTools({
    draftService,
    userRepo,
    surgeryRequestRepo,
    surgeryRequestsService,
    activityRepo,
    patientRepo,
    procedureRepo,
    patientsService,
    hospitalsService,
    healthPlansService,
    proceduresService,
    workflowService,
    documentRepo,
    pendencyValidator,
    doctorProfileRepo,
    storageService,
    configService,
    usersService,
    entityResolver,
    hospitalRepo,
    healthPlanRepo,
    tussService,
    cidService,
    mutationService,
    notificationService,
    tussItemRepo,
    opmeItemRepo,
    supplierRepo,
    opmeService,
    documentsService,
    documentDispatcher,
    conversationMemory,
    assemblyService,
  });
}

export const AI_TOOLS_INJECT: InjectionToken[] = [
  OperationDraftService,
  UserRepository,
  SurgeryRequestRepository,
  SurgeryRequestsService,
  SurgeryRequestActivityRepository,
  PatientRepository,
  ProcedureRepository,
  PatientsService,
  HospitalsService,
  HealthPlansService,
  ProceduresService,
  SurgeryRequestWorkflowService,
  DocumentRepository,
  PendencyValidatorService,
  DoctorProfileRepository,
  StorageService,
  ConfigService,
  UsersService,
  EntityResolverService,
  HospitalRepository,
  HealthPlanRepository,
  TussService,
  CidService,
  SurgeryRequestMutationService,
  SurgeryRequestNotificationService,
  SurgeryRequestTussItemRepository,
  OpmeItemRepository,
  SupplierRepository,
  OpmeService,
  DocumentsService,
  WhatsappDocumentDispatcherService,
  ConversationMemoryService,
  SurgeryRequestAssemblyService,
];
