import {
  Logger,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { SurgeryRequestTemplate } from 'src/database/entities/surgery-request-template.entity';

export interface TemplateUsageIncrementResponse {
  id: string;
  usageCount: number;
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
      templateData: dto.templateData,
    });
    const saved = await templateRepo.save(template);
    return templateRepo.findOne({
      where: { id: saved.id },
      relations: ['doctor'],
    });
  }

  getTemplates(userId: string, ownerId: string | null): Promise<any[]> {
    const tenantOwnerId = this.requireOwnerId(ownerId);
    const templateRepo = this.dataSource.getRepository(SurgeryRequestTemplate);
    return templateRepo.find({
      where: { doctorId: userId, ownerId: tenantOwnerId },
      relations: ['doctor'],
      order: { createdAt: 'DESC' },
    });
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
      template.templateData = dto.templateData;
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
