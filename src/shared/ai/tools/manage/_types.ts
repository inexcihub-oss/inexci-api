import { ConfigService } from '@nestjs/config';
import { SurgeryRequestRepository } from '../../../../database/repositories/surgery-request.repository';
import { SurgeryRequestActivityRepository } from '../../../../database/repositories/surgery-request-activity.repository';
import { SurgeryRequestTussItemRepository } from '../../../../database/repositories/surgery-request-tuss-item.repository';
import { OpmeItemRepository } from '../../../../database/repositories/opme-item.repository';
import { DocumentRepository } from '../../../../database/repositories/document.repository';
import { SupplierRepository } from '../../../../database/repositories/supplier.repository';
import { HealthPlanRepository } from '../../../../database/repositories/health-plan.repository';
import { SurgeryRequestsService } from '../../../../modules/surgery-requests/surgery-requests.service';
import { OpmeService } from '../../../../modules/surgery-requests/opme/opme.service';
import { DocumentsService } from '../../../../modules/surgery-requests/documents/documents.service';
import { StorageService } from '../../../storage/storage.service';
import { EntityResolverService } from '../../services/entity-resolver.service';
import { TussService } from '../../../../modules/tuss/tuss.service';

export interface ManageToolDeps {
  surgeryRequestRepo: SurgeryRequestRepository;
  surgeryRequestsService: SurgeryRequestsService;
  activityRepo: SurgeryRequestActivityRepository;
  tussItemRepo: SurgeryRequestTussItemRepository;
  opmeItemRepo: OpmeItemRepository;
  documentRepo: DocumentRepository;
  supplierRepo: SupplierRepository;
  healthPlanRepo: HealthPlanRepository;
  storageService: StorageService;
  configService: ConfigService;
  entityResolver?: EntityResolverService;
  tussService?: TussService;
  opmeService: OpmeService;
  documentsService: DocumentsService;
}
