/**
 * Fábrica central de todas as tools de IA.
 *
 * Fase 6 do `PLANO-SANITIZACAO-CLEAN-CODE-IA.md` — substitui o service
 * locator de 30+ deps no construtor do `ToolRegistryService` pelo padrão
 * "Opção B: multi-provider via token `AI_TOOL`".
 *
 * Este arquivo NÃO é um `@Module` NestJS — é um ES module TypeScript que:
 *   1. Declara `AllToolsDeps` com as dependências de todas os grupos de tools.
 *   2. Exporta `buildAllAiTools(deps)` com a lógica de agregação (ordem
 *      importa — não reordene sem bumpar `PROMPT_VERSION`).
 *   3. Exporta `aiToolsFactory` (função posicional compatível com `useFactory`
 *      do NestJS) e `AI_TOOLS_INJECT` (array de tokens para `inject`).
 *
 * Para adicionar uma nova tool:
 *   - Crie o arquivo `*.tool.ts` no subfolder correspondente.
 *   - Adicione a chamada ao builder neste arquivo (em `buildAllAiTools`).
 *   - Adicione o dep necessário em `AllToolsDeps`, `aiToolsFactory` e
 *     `AI_TOOLS_INJECT` se for uma nova dependência.
 *   - **Não mexa em `tool-registry.service.ts`.**
 */

import { ConfigService } from '@nestjs/config';
import { InjectionToken } from '@nestjs/common';

import { AiTool } from './tool.interface';
import { OperationDraftService } from '../services/operation-draft.service';
import { EntityResolverService } from '../services/entity-resolver.service';
import { WhatsappDocumentDispatcherService } from '../services/whatsapp-document-dispatcher.service';

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

// ─── Tipos ────────────────────────────────────────────────────────────────────

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
}

// ─── Fábrica principal ────────────────────────────────────────────────────────

/**
 * Constrói o array completo de tools na ordem canônica.
 *
 * ⚠️  ORDEM IMPORTA — não reordene sem bumpar `PROMPT_VERSION`.
 * O array resultante compõe o prefixo do request à OpenAI; qualquer mudança
 * de ordem invalida o prompt caching. Veja Fase 1 do
 * `PLANO-OTIMIZACAO-IA-WHATSAPP-EFICIENCIA.md`.
 */
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
  } = deps;

  return [
    ...buildPlanTools(draftService),
    ...buildScDraftTools({
      draftService,
      userRepo,
      surgeryRequestRepo,
      surgeryRequestsService,
      activityRepo,
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
    // Tools globais de draft (`draft_update`, `draft_status`, `draft_cancel`).
    // Mantidas ao FINAL da ordem para preservar o hash do prefixo de
    // prompt caching estável.
    ...buildDraftGenericTools({ draftService }),
  ];
}

// ─── Provider NestJS ──────────────────────────────────────────────────────────

/**
 * Função de fábrica posicional compatível com a propriedade `useFactory` do
 * NestJS. Os parâmetros DEVEM estar na MESMA ORDEM que `AI_TOOLS_INJECT`.
 *
 * Usar em `AiModule`:
 * ```ts
 * { provide: AI_TOOL, useFactory: aiToolsFactory, inject: AI_TOOLS_INJECT }
 * ```
 */
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
  });
}

/**
 * Tokens de injeção para o provider `AI_TOOL`.
 *
 * A ORDEM DEVE ser a mesma dos parâmetros de `aiToolsFactory`.
 * Adicionar um novo dep: acrescentar aqui E no final da lista de params
 * de `aiToolsFactory` (e no `AllToolsDeps`).
 */
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
];
