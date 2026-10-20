import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { DocumentExtractionService } from 'src/shared/ai/ocr/document-extraction.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { Patient } from 'src/database/entities/patient.entity';
import { PatientsService } from '../../patients/patients.service';
import { CreatePatientDto } from '../../patients/dto/create-patient.dto';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { executeInTransaction } from 'src/shared/utils/transaction.util';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';
import { SurgeryRequestMutationService } from './surgery-request-mutation.service';
import { SurgeryRequestAssemblyService } from './surgery-request-assembly.service';
import { DocumentEntityResolverService } from './document-entity-resolver.service';
import { DocumentsService } from '../documents/documents.service';
import { ExtractFromDocumentResponseDto } from '../dto/extract-from-document-response.dto';
import {
  CreateFromDocumentDto,
  NewPatientFromDocumentDto,
} from '../dto/create-from-document.dto';
import { ApplyDocumentExtractionDto } from '../dto/apply-document-extraction.dto';
import {
  SurgeryRequest,
  SurgeryRequestPriority,
  SurgeryRequestStatus,
} from 'src/database/entities/surgery-request.entity';
import { DOCUMENT_KEYS } from 'src/shared/constants/document-keys';
import { v4 as uuid } from 'uuid';
import * as path from 'path';

const TEMP_FOLDER = 'sc-from-document-tmp';
const MAX_DOCUMENT_NAME_LENGTH = 75;

@Injectable()
export class SurgeryRequestFromDocumentService {
  private readonly logger = new Logger(SurgeryRequestFromDocumentService.name);

  constructor(
    private readonly extractor: DocumentExtractionService,
    private readonly storage: StorageService,
    private readonly accessControl: AccessControlService,
    private readonly patientsService: PatientsService,
    private readonly mutationService: SurgeryRequestMutationService,
    private readonly assemblyService: SurgeryRequestAssemblyService,
    private readonly entityResolver: DocumentEntityResolverService,
    private readonly documentsService: DocumentsService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
  ) {}

  async extractFromDocument(
    file: Express.Multer.File,
    userId: string,
  ): Promise<ExtractFromDocumentResponseDto> {
    const maxBytes = this.configService.get<number>(
      'AI_DOC_MAX_BYTES',
      10 * 1024 * 1024,
    );
    if (file.size > maxBytes) {
      throw new BadRequestException(
        `Arquivo muito grande. Máximo permitido: ${Math.round(maxBytes / 1024 / 1024)} MB.`,
      );
    }

    const sessionId = uuid();
    const pipelineStartedAt = Date.now();
    const ownerId = await this.accessControl.getOwnerId(userId);
    const scMaxPages = this.configService.get<number>(
      'AI_DOC_SC_FROM_DOCUMENT_MAX_PAGES',
      15,
    );

    const result = await this.extractor.extractFromBuffer({
      buffer: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname,
      sessionId,
      intent: 'create_sc',
      maxOcrPages: scMaxPages,
      detokenizeExtracted: true,
    });

    if (!result.classification) {
      const msg =
        result.status === 'ocr_empty' || result.status === 'ocr_exception'
          ? 'Não foi possível extrair texto suficiente do documento. Verifique a qualidade do arquivo.'
          : 'Não foi possível classificar o documento. Tente novamente.';
      throw new BadRequestException(msg);
    }

    const ext =
      path.extname(file.originalname || 'doc').toLowerCase() || '.bin';
    const safeName = `${uuid()}${ext}`;

    const postProcessStartedAt = Date.now();
    const [tempStoragePath, candidates] = await Promise.all([
      this.storage.uploadBuffer(
        file.buffer,
        TEMP_FOLDER,
        safeName,
        file.mimetype,
        ownerId,
      ),
      this.entityResolver.resolveCandidates(
        result.classification.extracted,
        userId,
        ownerId,
      ),
    ]);
    const postProcessMs = Date.now() - postProcessStartedAt;

    const { classification } = result;
    const totalMs = Date.now() - pipelineStartedAt;
    const t = result.timing;

    this.logger.log(
      [
        `[SC_FROM_DOC] extract sessionId=${sessionId}`,
        `kind=${classification.kind}`,
        `confidence=${classification.confidence.toFixed(2)}`,
        `used_vision=${result.usedVisionFallback}`,
        `ocr_source=${result.ocrSource ?? 'none'}`,
        `total_ms=${totalMs}`,
        `ocr_ms=${t.ocrMs}`,
        `classifier_ms=${t.classifierMs}`,
        `vision_rasterize_ms=${t.visionRasterizeMs}`,
        `vision_ms=${t.visionMs}`,
        `detokenize_ms=${t.detokenizeMs}`,
        `post_process_ms=${postProcessMs}`,
        `tempPath=${tempStoragePath}`,
      ].join(' '),
    );

    return {
      kind: classification.kind,
      confidence: classification.confidence,
      extracted: classification.extracted,
      suggestedDocumentType: classification.suggestedDocumentType,
      ambiguity: classification.ambiguity,
      patientCpfMissing: candidates.patientCpfMissing,
      patientMatchedByCpf: candidates.patientMatchedByCpf,
      candidates: {
        patient: candidates.patient,
        hospital: candidates.hospital,
        healthPlan: candidates.healthPlan,
        procedure: candidates.procedure,
      },
      tempStoragePath,
    };
  }

  async createFromDocument(
    dto: CreateFromDocumentDto,
    userId: string,
  ): Promise<{ id: string; protocol: string; warnings: string[] }> {
    const ownerId = await this.accessControl.getOwnerId(userId);
    if (dto.tempStoragePath) {
      this.assertOwnedTemporaryStoragePath(dto.tempStoragePath, ownerId);
    }
    if (!dto.patientId && !dto.newPatient) {
      throw new BadRequestException(
        'É necessário informar um paciente existente (patientId) ou os dados do novo paciente (newPatient).',
      );
    }
    await this.mutationService.assertBelongsToOwner(
      {
        patientId: dto.patientId,
        hospitalId: dto.hospitalId,
        healthPlanId: dto.healthPlanId,
        procedureId: dto.procedureId,
      },
      ownerId,
    );

    const newPatientData = dto.patientId
      ? null
      : this.buildNewPatientData(dto.newPatient!);

    const { sc, createdPatient } = await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const createdPatient: Patient | null = newPatientData
          ? await this.patientsService.create(newPatientData, userId, {
              manager,
            })
          : null;
        const patientId = dto.patientId ?? createdPatient!.id;

        const [hospitalId, healthPlanId, procedureId] = await Promise.all([
          dto.hospitalId ||
            this.entityResolver.resolveOrCreateHospitalId(
              dto.hospitalName,
              ownerId,
              manager,
            ),
          dto.healthPlanId ||
            this.entityResolver.resolveOrCreateHealthPlanId(
              dto.healthPlanName,
              ownerId,
              manager,
            ),
          dto.procedureId ||
            this.entityResolver.resolveOrCreateProcedureId(
              dto.procedureName,
              ownerId,
              manager,
            ),
        ]);

        await this.backfillPatientInsurance(manager, {
          patientId,
          ownerId,
          healthPlanId,
          healthPlanNumber: dto.newPatient
            ? dto.newPatient.healthPlanNumber
            : dto.healthPlanNumber,
        });

        const sc = await this.mutationService.createSurgeryRequest(
          {
            doctorId: dto.doctorId,
            patientId,
            procedureId,
            priority: dto.priority ?? SurgeryRequestPriority.LOW,
            hospitalId,
            healthPlanId,
            healthPlanRegistration:
              dto.newPatient?.healthPlanNumber?.trim() ||
              dto.healthPlanNumber?.trim() ||
              undefined,
          },
          userId,
          { manager },
        );
        return { sc, createdPatient };
      },
      { logger: this.logger, operationName: 'createFromDocument' },
    );
    if (createdPatient) {
      await this.patientsService.sendWelcome(createdPatient);
    }
    await this.mutationService.broadcastCreated(sc.id, userId);

    const { warnings } = await this.assemblyService.assembleFromExtracted({
      scId: sc.id,
      notes: dto.notes,
      sections: dto.sections?.map((s) => ({
        title: s.title,
        description: s.description,
      })),
      suggestedSuppliers: dto.suggestedSuppliers,
      tussItems: dto.tussItems?.map((t) => ({
        code: t.tussCode,
        description: t.name,
        quantity: t.quantity,
      })),
      opmeItems: dto.opmeItems?.map((o) => ({
        description: o.description,
        qty: o.qty,
        suppliers: this.splitNames(o.supplier),
        manufacturers: this.splitNames(o.manufacturer),
      })),
      userId,
    });

    if (dto.tempStoragePath) {
      await this.attachSourceDocument({
        surgeryRequestId: sc.id,
        tempStoragePath: dto.tempStoragePath,
        originalFileName: dto.originalFileName,
        ownerId,
        userId,
        warnings,
      });
    }

    return { id: sc.id, protocol: sc.protocol ?? sc.id, warnings };
  }

  async applyDocumentExtraction(
    requestId: string,
    dto: ApplyDocumentExtractionDto,
    userId: string,
  ): Promise<{ warnings: string[] }> {
    const ownerId = await this.accessControl.getOwnerId(userId);
    const where = await this.accessControl.buildSurgeryAccessWhere(
      { id: requestId },
      userId,
    );
    const request = await this.surgeryRequestRepository.findOneSimple(where);
    if (!request)
      throw new NotFoundException(ERROR_MESSAGES.SURGERY_REQUEST_NOT_FOUND);
    if (request.status !== SurgeryRequestStatus.PENDING) {
      throw new BadRequestException(
        'A complementação por documento está disponível apenas para solicitações pendentes.',
      );
    }
    if (dto.tempStoragePath) {
      this.assertOwnedTemporaryStoragePath(dto.tempStoragePath, ownerId);
    }

    const update: Partial<
      Pick<
        SurgeryRequest,
        'procedureId' | 'hospitalId' | 'healthPlanId' | 'healthPlanRegistration'
      >
    > = {};
    if (dto.procedure && !request.procedureId) {
      update.procedureId =
        (await this.entityResolver.resolveOrCreateProcedureId(
          dto.procedureName,
          ownerId,
        )) ?? null;
    }
    if (dto.hospital && !request.hospitalId) {
      update.hospitalId =
        (await this.entityResolver.resolveOrCreateHospitalId(
          dto.hospitalName,
          ownerId,
        )) ?? null;
    }
    if (dto.healthPlan && !request.healthPlanId) {
      update.healthPlanId =
        (await this.entityResolver.resolveOrCreateHealthPlanId(
          dto.healthPlanName,
          ownerId,
        )) ?? null;
    }
    if (
      dto.healthPlan &&
      !request.healthPlanRegistration &&
      dto.healthPlanNumber?.trim()
    ) {
      update.healthPlanRegistration = dto.healthPlanNumber.trim();
    }
    if (Object.keys(update).length) {
      await this.surgeryRequestRepository.update(requestId, update);
    }
    const healthPlanId = update.healthPlanId ?? request.healthPlanId;
    if (dto.healthPlan && healthPlanId) {
      await this.backfillPatientInsurance(this.dataSource.manager, {
        patientId: request.patientId,
        ownerId,
        healthPlanId,
        healthPlanNumber: dto.healthPlanNumber,
      });
    }

    const { warnings } = await this.assemblyService.assembleFromExtracted({
      scId: requestId,
      userId,
      notes: dto.report ? dto.notes : undefined,
      sections: dto.report ? dto.sections : undefined,
      tussItems: dto.tuss
        ? dto.tussItems?.map((item) => ({
            code: item.tussCode,
            description: item.name,
            quantity: item.quantity,
          }))
        : undefined,
      opmeItems: dto.opme
        ? dto.opmeItems?.map((item) => ({
            description: item.description,
            qty: item.qty,
            supplier: item.supplier,
            manufacturer: item.manufacturer,
          }))
        : undefined,
      suggestedSuppliers: dto.opme ? dto.suggestedSuppliers : undefined,
    });
    if (dto.tempStoragePath) {
      await this.attachSourceDocument({
        surgeryRequestId: requestId,
        tempStoragePath: dto.tempStoragePath,
        originalFileName: dto.originalFileName,
        ownerId,
        userId,
        warnings,
      });
    }
    return { warnings };
  }

  private async attachSourceDocument(input: {
    surgeryRequestId: string;
    tempStoragePath: string;
    originalFileName?: string;
    ownerId: string;
    userId: string;
    warnings: string[];
  }): Promise<void> {
    try {
      const newPath = await this.storage.move(
        input.tempStoragePath,
        `documents/${input.ownerId}`,
      );
      await this.documentsService.createFromPath({
        surgeryRequestId: input.surgeryRequestId,
        storagePath: newPath,
        type: DOCUMENT_KEYS.SC_CREATION_SOURCE,
        key: DOCUMENT_KEYS.SC_CREATION_SOURCE,
        name: this.capDocumentName(
          input.originalFileName || path.basename(input.tempStoragePath),
        ),
        contentType: this.guessMimeFromPath(input.tempStoragePath),
        createdById: input.userId,
      });
    } catch (err) {
      const message = (err as Error)?.message || 'erro';
      input.warnings.push(`anexo do documento (${message})`);
      this.logger.warn(
        `[SC_FROM_DOC] attach failed scId=${input.surgeryRequestId}: ${message}`,
      );
    }
  }

  private buildNewPatientData(
    data: NewPatientFromDocumentDto,
  ): CreatePatientDto {
    const cpf = data.cpf.replace(/\D/g, '');
    if (cpf.length !== 11) {
      throw new BadRequestException(
        'CPF do novo paciente deve ter 11 dígitos.',
      );
    }
    return {
      name: data.name,
      cpf,
      birthDate: data.birthDate,
      gender: data.gender,
      phone: data.phone,
      email: data.email,
      address: data.address,
      addressNumber: data.addressNumber,
      addressComplement: data.addressComplement,
      neighborhood: data.neighborhood,
      city: data.city,
      state: data.state,
      zipCode: data.zipCode,
      healthPlanNumber: data.healthPlanNumber,
    };
  }

  private splitNames(raw?: string): string[] | undefined {
    if (!raw) return undefined;
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts : undefined;
  }

  private assertOwnedTemporaryStoragePath(
    storagePath: string,
    ownerId: string,
  ): void {
    const prefix = `${TEMP_FOLDER}/${ownerId}/`;
    const fileName = storagePath.slice(prefix.length);
    if (
      !storagePath.startsWith(prefix) ||
      !fileName ||
      fileName.includes('/') ||
      fileName.includes('\\')
    ) {
      throw new BadRequestException('Documento temporário inválido.');
    }
  }

  private async backfillPatientInsurance(
    manager: EntityManager,
    input: {
      patientId: string;
      ownerId: string;
      healthPlanId?: string | null;
      healthPlanNumber?: string;
    },
  ): Promise<void> {
    const healthPlanNumber = (input.healthPlanNumber ?? '').trim();
    if (!input.healthPlanId && !healthPlanNumber) return;

    const repo = manager.getRepository(Patient);
    const patient = await repo.findOne({
      where: { id: input.patientId, ownerId: input.ownerId },
      select: ['id', 'healthPlanId', 'healthPlanNumber'],
    });
    if (!patient) return;

    const updateData: {
      healthPlanId?: string | null;
      healthPlanNumber?: string | null;
    } = {};
    if (input.healthPlanId && patient.healthPlanId !== input.healthPlanId) {
      updateData.healthPlanId = input.healthPlanId;
    }
    if (healthPlanNumber && patient.healthPlanNumber !== healthPlanNumber) {
      updateData.healthPlanNumber = healthPlanNumber;
    }
    if (Object.keys(updateData).length === 0) return;

    await repo.update(patient.id, updateData);
  }

  private guessMimeFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const map: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
    };
    return map[ext] ?? 'application/octet-stream';
  }

  private capDocumentName(name: string): string {
    if (name.length <= MAX_DOCUMENT_NAME_LENGTH) return name;
    const ext = path.extname(name);
    const base = path
      .basename(name, ext)
      .slice(0, MAX_DOCUMENT_NAME_LENGTH - ext.length);
    return `${base}${ext}`;
  }
}
