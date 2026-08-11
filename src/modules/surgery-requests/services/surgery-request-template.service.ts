import {
  Logger,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { SurgeryRequestTemplate } from 'src/database/entities/surgery-request-template.entity';
import { SurgeryRequestPriority } from 'src/database/entities/surgery-request.entity';
import { sanitizeTemplateData } from './surgery-request-template-data';

export interface TemplateUsageIncrementResponse {
  id: string;
  usageCount: number;
}

/**
 * O que a listagem devolve. As duas telas que a consomem — o seletor de modelo
 * do wizard e a tabela de Procedimentos — só pintam texto; os itens TUSS, OPME
 * e documentos aparecem no detalhe (`getTemplate`), quando o modelo é aberto ou
 * usado. Antes ia o `templateData` inteiro por linha mais o `User` do médico,
 * com cpf, telefone e endereço junto.
 */
export interface SurgeryRequestTemplateSummary {
  id: string;
  name: string;
  /** Os ids acompanham os nomes porque o formulário de nova SC preenche com eles. */
  procedureId: string | null;
  procedureName: string | null;
  hospitalId: string | null;
  hospitalName: string | null;
  healthPlanId: string | null;
  healthPlanName: string | null;
  priority: SurgeryRequestPriority | null;
  doctorName: string | null;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SurgeryRequestTemplateService {
  private readonly logger = new Logger(SurgeryRequestTemplateService.name);
  constructor(private readonly dataSource: DataSource) {}

  async createTemplate(
    dto: { name: string; templateData: object },
    userId: string,
    ownerId: string | null,
  ): Promise<any> {
    const tenantOwnerId = this.requireOwnerId(ownerId);
    const templateRepo = this.dataSource.getRepository(SurgeryRequestTemplate);
    const template = templateRepo.create({
      doctorId: userId,
      ownerId: tenantOwnerId,
      name: dto.name,
      templateData: sanitizeTemplateData(dto.templateData),
    });
    const saved = await templateRepo.save(template);
    return templateRepo.findOne({ where: { id: saved.id } });
  }

  async getTemplates(
    userId: string,
    ownerId: string | null,
  ): Promise<SurgeryRequestTemplateSummary[]> {
    const tenantOwnerId = this.requireOwnerId(ownerId);
    const templateRepo = this.dataSource.getRepository(SurgeryRequestTemplate);
    const templates = await templateRepo.find({
      where: { doctorId: userId, ownerId: tenantOwnerId },
      // `templateData` entra porque o resumo é derivado dele, mas não sai na
      // resposta; do médico vem só o nome, exibido na coluna "Criado por".
      select: {
        id: true,
        name: true,
        usageCount: true,
        createdAt: true,
        updatedAt: true,
        templateData: true,
        doctor: { name: true },
      },
      relations: ['doctor'],
      order: { createdAt: 'DESC' },
    });

    return templates.map((template) => this.toSummary(template));
  }

  async getTemplate(
    id: string,
    userId: string,
    ownerId: string | null,
  ): Promise<SurgeryRequestTemplate> {
    const tenantOwnerId = this.requireOwnerId(ownerId);
    const templateRepo = this.dataSource.getRepository(SurgeryRequestTemplate);
    const template = await templateRepo.findOne({
      where: { id, doctorId: userId, ownerId: tenantOwnerId },
    });
    if (!template) {
      throw new NotFoundException('Template não encontrado ou sem permissão.');
    }
    return template;
  }

  private toSummary(
    template: SurgeryRequestTemplate,
  ): SurgeryRequestTemplateSummary {
    const data = sanitizeTemplateData(template.templateData);
    return {
      id: template.id,
      name: template.name,
      procedureId: data.procedure?.id ?? null,
      procedureName: data.procedure?.name ?? data.procedureName ?? null,
      hospitalId: data.hospital?.id ?? null,
      hospitalName: data.hospital?.name ?? null,
      healthPlanId: data.healthPlan?.id ?? null,
      healthPlanName: data.healthPlan?.name ?? null,
      priority: data.priority ?? null,
      doctorName: template.doctor?.name ?? null,
      usageCount: template.usageCount,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }

  async updateTemplate(
    id: string,
    dto: { name?: string; templateData?: object },
    userId: string,
    ownerId: string | null,
  ): Promise<any> {
    const tenantOwnerId = this.requireOwnerId(ownerId);
    const templateRepo = this.dataSource.getRepository(SurgeryRequestTemplate);
    const template = await templateRepo.findOne({
      where: { id, doctorId: userId, ownerId: tenantOwnerId },
    });
    if (!template) {
      throw new NotFoundException('Template não encontrado ou sem permissão.');
    }
    if (dto.name !== undefined) template.name = dto.name;
    if (dto.templateData !== undefined)
      template.templateData = sanitizeTemplateData(dto.templateData);
    return templateRepo.save(template);
  }

  async deleteTemplate(
    id: string,
    userId: string,
    ownerId: string | null,
  ): Promise<void> {
    const tenantOwnerId = this.requireOwnerId(ownerId);
    const templateRepo = this.dataSource.getRepository(SurgeryRequestTemplate);
    const template = await templateRepo.findOne({
      where: { id, doctorId: userId, ownerId: tenantOwnerId },
    });
    if (!template) {
      throw new NotFoundException('Template não encontrado ou sem permissão.');
    }
    await templateRepo.remove(template);
  }

  async bulkDeleteTemplates(
    ids: string[],
    userId: string,
    ownerId: string | null,
  ): Promise<{ deleted: number }> {
    const tenantOwnerId = this.requireOwnerId(ownerId);
    const uniqueIds = [...new Set(ids)];
    const templateRepo = this.dataSource.getRepository(SurgeryRequestTemplate);

    const templates = await templateRepo.find({
      where: {
        id: In(uniqueIds),
        doctorId: userId,
        ownerId: tenantOwnerId,
      },
      select: {
        id: true,
      },
    });

    if (templates.length !== uniqueIds.length) {
      throw new NotFoundException(
        'Um ou mais templates não foram encontrados.',
      );
    }

    await templateRepo.delete({
      id: In(uniqueIds),
      doctorId: userId,
      ownerId: tenantOwnerId,
    });

    return { deleted: uniqueIds.length };
  }

  async incrementUsage(
    id: string,
    userId: string,
    ownerId: string | null,
  ): Promise<TemplateUsageIncrementResponse> {
    const tenantOwnerId = this.requireOwnerId(ownerId);
    const templateRepo = this.dataSource.getRepository(SurgeryRequestTemplate);
    const template = await templateRepo.findOne({
      where: [
        { id, doctorId: userId, ownerId: tenantOwnerId },
        { id, ownerId: tenantOwnerId },
      ],
      select: {
        id: true,
        usageCount: true,
      },
    });
    if (!template) {
      throw new NotFoundException('Template não encontrado ou sem permissão.');
    }

    await templateRepo.increment({ id: template.id }, 'usageCount', 1);

    const updatedTemplate = await templateRepo.findOne({
      where: { id: template.id, ownerId: tenantOwnerId },
      select: {
        id: true,
        usageCount: true,
      },
    });

    if (!updatedTemplate) {
      throw new NotFoundException('Template não encontrado ou sem permissão.');
    }

    return {
      id: updatedTemplate.id,
      usageCount: updatedTemplate.usageCount,
    };
  }

  private requireOwnerId(ownerId: string | null): string {
    if (!ownerId) {
      throw new ForbiddenException(
        'ownerId ausente para operação de template.',
      );
    }
    return ownerId;
  }
}
