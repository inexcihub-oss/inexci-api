import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClinicalRecordTemplateRepository } from 'src/database/repositories/clinical-record-template.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { ClinicalRecordTemplate } from 'src/database/entities/clinical-record-template.entity';
import { CreateClinicalRecordTemplateDto } from './dto/create-clinical-record-template.dto';
import { UpdateClinicalRecordTemplateDto } from './dto/update-clinical-record-template.dto';

const CLINICAL_FIELDS = [
  'anamnesis',
  'physicalExam',
  'diagnosis',
  'conduct',
  'cidCodes',
] as const;

export const SOMENTE_PROPRIO_MODELO =
  'Você só pode criar e alterar os seus próprios modelos de anamnese.';

@Injectable()
export class ClinicalRecordTemplatesService {
  constructor(
    private readonly templateRepository: ClinicalRecordTemplateRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async findMany(userId: string): Promise<ClinicalRecordTemplate[]> {
    if (!(await this.accessControlService.isDoctor(userId))) return [];
    const ownerId = await this.accessControlService.getOwnerId(userId);
    return this.templateRepository.findByOwner(ownerId, userId);
  }

  async create(
    data: CreateClinicalRecordTemplateDto,
    userId: string,
  ): Promise<ClinicalRecordTemplate> {
    await this.accessControlService.assertIsDoctor(userId);
    if (data.doctorId !== undefined && data.doctorId !== userId) {
      throw new ForbiddenException(SOMENTE_PROPRIO_MODELO);
    }
    const ownerId = await this.accessControlService.getOwnerId(userId);

    return this.templateRepository.create({
      ownerId,
      doctorId: userId,
      name: data.name,
      specialty: data.specialty ?? null,
      anamnesis: data.anamnesis ?? null,
      physicalExam: data.physicalExam ?? null,
      diagnosis: data.diagnosis ?? null,
      conduct: data.conduct ?? null,
      cidCodes: data.cidCodes ?? null,
    });
  }

  async update(
    id: string,
    data: UpdateClinicalRecordTemplateDto,
    userId: string,
  ): Promise<ClinicalRecordTemplate> {
    await this.getProprio(id, userId);

    const updateData: Partial<ClinicalRecordTemplate> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.specialty !== undefined) updateData.specialty = data.specialty;
    for (const field of CLINICAL_FIELDS) {
      if (data[field] !== undefined) {
        (updateData as Record<string, unknown>)[field] = data[field];
      }
    }

    return (await this.templateRepository.update(id, updateData))!;
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.getProprio(id, userId);
    await this.templateRepository.delete(id);
  }

  async apply(id: string, userId: string): Promise<ClinicalRecordTemplate> {
    const template = await this.getProprio(id, userId);
    await this.templateRepository.incrementUsage(id);
    return template;
  }

  private async getProprio(
    id: string,
    userId: string,
  ): Promise<ClinicalRecordTemplate> {
    await this.accessControlService.assertIsDoctor(userId);
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const template = await this.templateRepository.findOne({
      id,
      ownerId,
      doctorId: userId,
    });
    if (!template) throw new NotFoundException('Modelo não encontrado');
    return template;
  }
}
