import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ClinicalDocumentTemplate,
  ClinicalDocumentTemplateKind,
} from 'src/database/entities/clinical-document-template.entity';
import { ClinicalDocumentTemplateRepository } from 'src/database/repositories/clinical-document-template.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { CreateClinicalDocumentTemplateDto } from './dto/create-clinical-document-template.dto';
import { UpdateClinicalDocumentTemplateDto } from './dto/update-clinical-document-template.dto';

@Injectable()
export class ClinicalDocumentTemplatesService {
  constructor(
    private readonly templateRepository: ClinicalDocumentTemplateRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async findMany(
    userId: string,
    filtro: { kind?: ClinicalDocumentTemplateKind; doctorId?: string } = {},
  ): Promise<ClinicalDocumentTemplate[]> {
    const [ownerId, acessiveis] = await Promise.all([
      this.accessControlService.getOwnerId(userId),
      this.accessControlService.getAccessibleDoctorIds(userId),
    ]);
    if (filtro.doctorId && !acessiveis.includes(filtro.doctorId)) {
      throw new ForbiddenException('Médico não acessível para esta operação.');
    }
    if (!acessiveis.length) return [];
    const permitidos = new Set(acessiveis);
    const modelos = await this.templateRepository.findByOwner(ownerId, filtro);
    return modelos.filter((modelo) => permitidos.has(modelo.doctorId));
  }

  async create(
    data: CreateClinicalDocumentTemplateDto,
    userId: string,
  ): Promise<ClinicalDocumentTemplate> {
    await this.accessControlService.assertCanIssueClinicalDocuments(userId);
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const doctorId =
      data.doctorId ??
      (await this.accessControlService.resolveDefaultDoctorId(userId));
    if (!(await this.accessControlService.canAccessDoctor(userId, doctorId))) {
      throw new ForbiddenException('Médico não acessível para esta operação.');
    }
    if (doctorId !== userId) {
      await this.accessControlService.assertCanIssueClinicalDocuments(
        doctorId,
        {
          mensagem:
            'O modelo só pode pertencer a um médico (CRM) ou dentista (CRO).',
        },
      );
    }

    return this.templateRepository.create({
      ownerId,
      doctorId,
      kind: data.kind,
      name: data.name.trim(),
      body: data.body,
    });
  }

  async update(
    id: string,
    data: UpdateClinicalDocumentTemplateDto,
    userId: string,
  ): Promise<ClinicalDocumentTemplate> {
    await this.getEditable(id, userId);
    const mudancas: Partial<ClinicalDocumentTemplate> = {};
    if (data.name !== undefined) mudancas.name = data.name.trim();
    if (data.body !== undefined) mudancas.body = data.body;
    return (await this.templateRepository.update(id, mudancas))!;
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.getEditable(id, userId);
    await this.templateRepository.softDelete(id);
  }

  async getForUse(
    id: string,
    kind: ClinicalDocumentTemplateKind | null,
    userId: string,
    signingDoctorId: string,
  ): Promise<ClinicalDocumentTemplate> {
    const template = await this.templateRepository.findOne({ id });
    if (!template) throw new NotFoundException('Modelo não encontrado');
    await this.accessControlService.assertCanAccessDoctorResource(
      userId,
      template.ownerId,
      template.doctorId,
    );
    if (template.doctorId !== signingDoctorId) {
      throw new BadRequestException(
        'Este modelo é de outro profissional — use um modelo de quem assina o documento.',
      );
    }
    if (kind && template.kind !== kind) {
      throw new BadRequestException(
        'Este modelo é de outro tipo de documento.',
      );
    }
    return template;
  }

  incrementUsage(id: string): Promise<void> {
    return this.templateRepository.incrementUsage(id);
  }

  private async getEditable(
    id: string,
    userId: string,
  ): Promise<ClinicalDocumentTemplate> {
    await this.accessControlService.assertCanIssueClinicalDocuments(userId);
    const template = await this.templateRepository.findOne({ id });
    if (!template) throw new NotFoundException('Modelo não encontrado');
    await this.accessControlService.assertCanAccessDoctorResource(
      userId,
      template.ownerId,
      template.doctorId,
    );
    return template;
  }
}
