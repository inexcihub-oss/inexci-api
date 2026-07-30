import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StorageService } from 'src/shared/storage/storage.service';
import { DocumentRepository } from 'src/database/repositories/document.repository';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { auditProntuarioAccess } from 'src/shared/logging/audit';
import { transformDocumentUrls } from 'src/shared/transformers/signed-url.transformer';
import { executeInTransaction } from 'src/shared/utils/transaction.util';
import { Document } from 'src/database/entities/document.entity';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';
import { CreateClinicalDocumentDto } from './dto/create-clinical-document.dto';
import { DeleteClinicalDocumentDto } from './dto/delete-clinical-document.dto';

/**
 * Documentos (exames/anexos) vinculados ao paciente — e opcionalmente à ficha
 * de atendimento. Segue o molde de `surgery-requests/documents`, mas escopa a
 * posse pelo `ownerId` do paciente em vez de um guard de solicitação cirúrgica.
 */
@Injectable()
export class ClinicalDocumentsService {
  private readonly logger = new Logger(ClinicalDocumentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly documentRepository: DocumentRepository,
    private readonly patientRepository: PatientRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async create(
    data: CreateClinicalDocumentDto,
    userId: string,
    file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File is required');

    const patient = await this.assertPatientAccess(data.patientId, userId);

    const storagePath = await this.storageService.create(
      file,
      data.folder,
      patient.ownerId,
    );

    const newDocument = await this.documentRepository.create({
      patientId: data.patientId,
      clinicalRecordId: data.clinicalRecordId ?? null,
      createdById: userId,
      type: data.type,
      key: data.key,
      name: data.name,
      uri: storagePath,
    });

    auditProntuarioAccess({
      resource: 'clinical_record',
      resourceId: data.patientId,
      action: 'create',
      actorUserId: userId,
      tenantId: patient.ownerId,
    });

    return {
      ...newDocument,
      path: storagePath,
      uri: await this.storageService.getSignedUrl(storagePath),
    };
  }

  /** Lista os documentos do paciente com URLs assinadas. */
  async listByPatient(patientId: string, userId: string): Promise<Document[]> {
    const patient = await this.assertPatientAccess(patientId, userId);

    auditProntuarioAccess({
      resource: 'clinical_record',
      resourceId: patientId,
      action: 'list',
      actorUserId: userId,
      tenantId: patient.ownerId,
    });

    const documents =
      await this.documentRepository.findByPatientId(patientId);
    return transformDocumentUrls(documents, this.storageService);
  }

  async delete(data: DeleteClinicalDocumentDto, userId: string) {
    const document = await this.documentRepository.findOneSimple({
      id: data.id,
    });
    if (!document || !document.patientId) {
      throw new NotFoundException(ERROR_MESSAGES.DOCUMENT_NOT_FOUND);
    }
    const patient = await this.assertPatientAccess(document.patientId, userId);

    await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const documentRepo = manager.getRepository(Document);
        await documentRepo.delete({ id: data.id, key: data.key });

        if (document.uri) {
          try {
            await this.storageService.delete(document.uri);
          } catch (error) {
            this.logger.warn('Erro ao deletar arquivo do storage', error);
          }
        }
      },
      { logger: this.logger, operationName: 'deleteClinicalDocument' },
    );

    auditProntuarioAccess({
      resource: 'clinical_record',
      resourceId: document.patientId,
      action: 'delete',
      actorUserId: userId,
      tenantId: patient.ownerId,
    });
  }

  private async assertPatientAccess(patientId: string, userId: string) {
    const patient = await this.patientRepository.findOne({ id: patientId });
    if (!patient) throw new NotFoundException('Paciente não encontrado');
    await this.accessControlService.assertSameOwner(userId, patient.ownerId);
    return patient;
  }
}
