import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { DocumentExtractionService } from 'src/shared/ai/ocr/document-extraction.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { Patient } from 'src/database/entities/patient.entity';
import { Hospital } from 'src/database/entities/hospital.entity';
import { HealthPlan } from 'src/database/entities/health-plan.entity';
import { Procedure } from 'src/database/entities/procedure.entity';
import { PatientsService } from '../../patients/patients.service';
import { SurgeryRequestsService } from '../surgery-requests.service';
import { SurgeryRequestMutationService } from './surgery-request-mutation.service';
import { SurgeryRequestAssemblyService } from './surgery-request-assembly.service';
import { DocumentEntityResolverService } from './document-entity-resolver.service';
import { DocumentsService } from '../documents/documents.service';
import { ExtractFromDocumentResponseDto } from '../dto/extract-from-document-response.dto';
import {
  CreateFromDocumentDto,
  NewPatientFromDocumentDto,
} from '../dto/create-from-document.dto';
import { SurgeryRequestPriority } from 'src/database/entities/surgery-request.entity';
import { DOCUMENT_KEYS } from 'src/shared/constants/document-keys';
import { v4 as uuid } from 'uuid';
import * as path from 'path';

const TEMP_FOLDER = 'sc-from-document-tmp';
const MAX_PROCEDURE_NAME_LENGTH = 255;
// documents.name é varchar(75); nome de arquivo maior estoura o insert e
// derruba silenciosamente o anexo do documento de origem.
const MAX_DOCUMENT_NAME_LENGTH = 75;

@Injectable()
export class SurgeryRequestFromDocumentService {
  private readonly logger = new Logger(SurgeryRequestFromDocumentService.name);

  constructor(
    private readonly extractor: DocumentExtractionService,
    private readonly storage: StorageService,
    private readonly accessControl: AccessControlService,
    private readonly patientsService: PatientsService,
    private readonly surgeryRequestsService: SurgeryRequestsService,
    private readonly mutationService: SurgeryRequestMutationService,
    private readonly assemblyService: SurgeryRequestAssemblyService,
    private readonly entityResolver: DocumentEntityResolverService,
    private readonly documentsService: DocumentsService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // EXTRAÇÃO (Tarefa 5 — POST /surgery-requests/extract-from-document)
  // ──────────────────────────────────────────────────────────────────────────

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

  // ──────────────────────────────────────────────────────────────────────────
  // CRIAÇÃO (Tarefa 6 — POST /surgery-requests/from-document)
  // ──────────────────────────────────────────────────────────────────────────

  async createFromDocument(
    dto: CreateFromDocumentDto,
    userId: string,
  ): Promise<{ id: string; protocol: string; warnings: string[] }> {
    const ownerId = await this.accessControl.getOwnerId(userId);

    const resolvedHospitalId =
      dto.hospitalId ||
      (await this.resolveOrCreateHospitalId(dto.hospitalName, ownerId));
    const resolvedHealthPlanId =
      dto.healthPlanId ||
      (await this.resolveOrCreateHealthPlanId(dto.healthPlanName, ownerId));
    const resolvedProcedureId =
      dto.procedureId ||
      (await this.resolveOrCreateProcedureId(dto.procedureName, ownerId));

    let patientId = dto.patientId;

    if (!patientId && dto.newPatient) {
      patientId = await this.createPatient(
        dto.newPatient,
        resolvedHealthPlanId,
        userId,
      );
    } else if (patientId) {
      await this.backfillExistingPatientInsurance({
        patientId,
        ownerId,
        healthPlanId: resolvedHealthPlanId,
        healthPlanNumber: dto.healthPlanNumber,
      });
    }

    if (!patientId) {
      throw new BadRequestException(
        'É necessário informar um paciente existente (patientId) ou os dados do novo paciente (newPatient).',
      );
    }

    if (!resolvedProcedureId) {
      throw new BadRequestException(
        'Informe um procedimento para criar a solicitação.',
      );
    }

    const sc = await this.mutationService.createSurgeryRequest(
      {
        doctorId: dto.doctorId,
        patientId,
        procedureId: resolvedProcedureId,
        priority: dto.priority ?? SurgeryRequestPriority.LOW,
        hospitalId: resolvedHospitalId,
        healthPlanId: resolvedHealthPlanId,
        healthPlanRegistration:
          dto.newPatient?.healthPlanNumber?.trim() ||
          dto.healthPlanNumber?.trim() ||
          undefined,
      },
      userId,
    );

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
      try {
        const ownerId = await this.accessControl.getOwnerId(userId);
        const destFolder = `documents/${ownerId}`;
        const newPath = await this.storage.move(
          dto.tempStoragePath,
          destFolder,
        );
        const fileName = this.capDocumentName(
          dto.originalFileName || path.basename(dto.tempStoragePath),
        );
        await this.documentsService.createFromPath({
          surgeryRequestId: sc.id,
          storagePath: newPath,
          type: DOCUMENT_KEYS.SC_CREATION_SOURCE,
          name: fileName,
          key: DOCUMENT_KEYS.SC_CREATION_SOURCE,
          contentType: this.guessMimeFromPath(dto.tempStoragePath),
          createdById: userId,
        });
      } catch (err: any) {
        warnings.push(`anexo do documento (${err?.message || 'erro'})`);
        this.logger.warn(
          `[SC_FROM_DOC] attach failed scId=${sc.id}: ${err?.message}`,
        );
      }
    }

    return { id: sc.id, protocol: sc.protocol ?? sc.id, warnings };
  }

  private async createPatient(
    data: NewPatientFromDocumentDto,
    healthPlanId: string | undefined,
    userId: string,
  ): Promise<string> {
    const cpf = data.cpf.replace(/\D/g, '');
    if (cpf.length !== 11) {
      throw new BadRequestException(
        'CPF do novo paciente deve ter 11 dígitos.',
      );
    }
    const patient = await this.patientsService.create(
      {
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
        healthPlanId,
        healthPlanNumber: data.healthPlanNumber,
      },
      userId,
    );
    return patient.id;
  }

  private splitNames(raw?: string): string[] | undefined {
    if (!raw) return undefined;
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts : undefined;
  }

  private async resolveOrCreateHospitalId(
    hospitalName: string | undefined,
    ownerId: string,
  ): Promise<string | undefined> {
    const name = (hospitalName ?? '').trim();
    if (!name) return undefined;

    const repo = this.dataSource.getRepository(Hospital);
    const existing = await repo
      .createQueryBuilder('h')
      .where('h.owner_id = :ownerId', { ownerId })
      .andWhere('unaccent(lower(h.name)) = unaccent(lower(:name))', { name })
      .select(['h.id'])
      .getOne();

    if (existing?.id) return existing.id;

    const created = repo.create({ name, ownerId, active: true });
    const saved = await repo.save(created);
    return saved.id;
  }

  private async resolveOrCreateHealthPlanId(
    healthPlanName: string | undefined,
    ownerId: string,
  ): Promise<string | undefined> {
    const name = (healthPlanName ?? '').trim();
    if (!name) return undefined;

    const repo = this.dataSource.getRepository(HealthPlan);
    const existing = await repo
      .createQueryBuilder('hp')
      .where('hp.owner_id = :ownerId', { ownerId })
      .andWhere('unaccent(lower(hp.name)) = unaccent(lower(:name))', { name })
      .select(['hp.id'])
      .getOne();

    if (existing?.id) return existing.id;

    const created = repo.create({ name, ownerId, active: true });
    const saved = await repo.save(created);
    return saved.id;
  }

  private async resolveOrCreateProcedureId(
    procedureName: string | undefined,
    ownerId: string,
  ): Promise<string | undefined> {
    const name = this.normalizeProcedureName(procedureName);
    if (!name) return undefined;

    const repo = this.dataSource.getRepository(Procedure);
    const existing = await repo
      .createQueryBuilder('p')
      .where('p.owner_id = :ownerId', { ownerId })
      .andWhere('unaccent(lower(p.name)) = unaccent(lower(:name))', { name })
      .select(['p.id'])
      .getOne();

    if (existing?.id) return existing.id;

    const created = repo.create({ name, ownerId });
    const saved = await repo.save(created);
    return saved.id;
  }

  private normalizeProcedureName(raw: string | undefined): string | undefined {
    const name = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (!name) return undefined;

    if (name.length > MAX_PROCEDURE_NAME_LENGTH) {
      this.logger.warn(
        `[SC_FROM_DOC] procedure_name_too_long len=${name.length} max=${MAX_PROCEDURE_NAME_LENGTH} dropping_auto_create`,
      );
      return undefined;
    }

    return name;
  }

  private async backfillExistingPatientInsurance(input: {
    patientId: string;
    ownerId: string;
    healthPlanId?: string;
    healthPlanNumber?: string;
  }): Promise<void> {
    const healthPlanNumber = (input.healthPlanNumber ?? '').trim();
    if (!input.healthPlanId && !healthPlanNumber) return;

    const repo = this.dataSource.getRepository(Patient);
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

  /** Trunca o nome para caber em documents.name (varchar 75), preservando a extensão. */
  private capDocumentName(name: string): string {
    if (name.length <= MAX_DOCUMENT_NAME_LENGTH) return name;
    const ext = path.extname(name);
    const base = path
      .basename(name, ext)
      .slice(0, MAX_DOCUMENT_NAME_LENGTH - ext.length);
    return `${base}${ext}`;
  }
}
