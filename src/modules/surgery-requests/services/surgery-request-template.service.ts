import { Logger, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SurgeryRequestTemplate } from 'src/database/entities/surgery-request-template.entity';

@Injectable()
export class SurgeryRequestTemplateService {
  private readonly logger = new Logger(SurgeryRequestTemplateService.name);
  constructor(private readonly dataSource: DataSource) {}

  async createTemplate(
    dto: { name: string; templateData: object },
    userId: string,
  ): Promise<any> {
    const templateRepo = this.dataSource.getRepository(SurgeryRequestTemplate);
    const template = templateRepo.create({
      doctorId: userId,
      name: dto.name,
      templateData: dto.templateData,
    });
    const saved = await templateRepo.save(template);
    return templateRepo.findOne({
      where: { id: saved.id },
      relations: ['doctor'],
    });
  }

  getTemplates(userId: string): Promise<any[]> {
    const templateRepo = this.dataSource.getRepository(SurgeryRequestTemplate);
    return templateRepo.find({
      where: { doctorId: userId },
      relations: ['doctor'],
      order: { createdAt: 'DESC' },
    });
  }

  async updateTemplate(
    id: string,
    dto: { name?: string; templateData?: object },
    userId: string,
  ): Promise<any> {
    const templateRepo = this.dataSource.getRepository(SurgeryRequestTemplate);
    const template = await templateRepo.findOne({
      where: { id, doctorId: userId },
    });
    if (!template) {
      throw new NotFoundException('Template não encontrado ou sem permissão.');
    }
    if (dto.name !== undefined) template.name = dto.name;
    if (dto.templateData !== undefined)
      template.templateData = dto.templateData;
    return templateRepo.save(template);
  }

  async deleteTemplate(id: string, userId: string): Promise<void> {
    const templateRepo = this.dataSource.getRepository(SurgeryRequestTemplate);
    const template = await templateRepo.findOne({
      where: { id, doctorId: userId },
    });
    if (!template) {
      throw new NotFoundException('Template não encontrado ou sem permissão.');
    }
    await templateRepo.remove(template);
  }

  async incrementUsage(id: string, userId: string): Promise<any> {
    const templateRepo = this.dataSource.getRepository(SurgeryRequestTemplate);
    const template = await templateRepo.findOne({
      where: { id, doctorId: userId },
      relations: ['doctor'],
    });
    if (!template) {
      throw new NotFoundException('Template não encontrado ou sem permissão.');
    }
    template.usageCount = (template.usageCount || 0) + 1;
    return templateRepo.save(template);
  }
}
