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
import { ClinicalRecordRepository } from 'src/database/repositories/clinical-record.repository';
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
    private readonly clinicalRecordRepository: ClinicalRecordRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async create(
    data: CreateClinicalDocumentDto,
    userId: string,
    file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File is required');

    const patient = await this.assertPatientAccess(data.patientId, userId);

    if (data.clinicalRecordId) {
      await this.assertRecordAccess(
        data.clinicalRecordId,
        data.patientId,
        userId,
      );
    }

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

    const documents = await this.documentRepository.findByPatientId(patientId);
    return transformDocumentUrls(documents, this.storageService);
  }

  async delete(data: DeleteClinicalDocumentDto, userId: string) {
    const document = await this.documentRepository.findOneSimple({
      id: data.id,
    });
    // O `key` entra no WHERE do DELETE abaixo. Se ele não casar com o do
    // documento carregado, o banco não remove linha nenhuma — mas o arquivo do
    // R2 é apagado assim mesmo (o storage usa a `uri` do documento, não o
    // `key`), deixando um anexo clínico fantasma: visível na lista, 404 ao
    // abrir. Valida antes de qualquer efeito e devolve o mesmo 404 de
    // "documento não encontrado", sem dizer qual dos dois campos divergiu.
    if (!document || !document.patientId || document.key !== data.key) {
      throw new NotFoundException(ERROR_MESSAGES.DOCUMENT_NOT_FOUND);
    }
    const patient = await this.assertPatientAccess(document.patientId, userId);

    await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const documentRepo = manager.getRepository(Document);
        const result = await documentRepo.delete({
          id: data.id,
          key: data.key,
        });

        // Segunda trava, agora sobre o efeito real: só encosta no R2 depois de
        // a linha ter de fato saído do banco. Sem o `affected`, uma corrida (ou
        // um WHERE que deixe de casar) apagaria o arquivo de um registro vivo.
        if (!result.affected) {
          throw new NotFoundException(ERROR_MESSAGES.DOCUMENT_NOT_FOUND);
        }

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

  /**
   * Vincular o anexo a uma ficha exige acesso àquela ficha — o paciente é
   * visível para toda a clínica, mas o prontuário é recortado por médico.
   * Também amarra a ficha ao paciente informado, para o anexo não aparecer no
   * atendimento de outro paciente.
   */
  private async assertRecordAccess(
    clinicalRecordId: string,
    patientId: string,
    userId: string,
  ): Promise<void> {
    const record = await this.clinicalRecordRepository.findOne({
      id: clinicalRecordId,
    });
    if (!record || record.patientId !== patientId) {
      throw new BadRequestException('Atendimento inválido para este paciente.');
    }
    await this.accessControlService.assertCanAccessDoctorResource(
      userId,
      record.ownerId,
      record.doctorId,
    );
  }
}
