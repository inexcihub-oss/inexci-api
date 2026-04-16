import { Logger, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SurgeryRequestTemplate } from 'src/database/entities/surgery-request-template.entity';

@Injectable()
export class SurgeryRequestTemplateService {
  private readonly logger = new Logger(SurgeryRequestTemplateService.name);
  constructor(private readonly dataSource: DataSource) {}

  async createTemplate(
    dto: { name: string; template_data: object },
    userId: string,
  ): Promise<any> {
    const templateRepo = this.dataSource.getRepository(SurgeryRequestTemplate);
    const template = templateRepo.create({
      doctor_id: userId,
      name: dto.name,
      template_data: dto.template_data,
    });
    return templateRepo.save(template);
  }

  async getTemplates(userId: string): Promise<any[]> {
    const templateRepo = this.dataSource.getRepository(SurgeryRequestTemplate);
    return templateRepo.find({
      where: { doctor_id: userId },
      order: { created_at: 'DESC' },
    });
  }

  async deleteTemplate(id: string, userId: string): Promise<void> {
    const templateRepo = this.dataSource.getRepository(SurgeryRequestTemplate);
    const template = await templateRepo.findOne({
      where: { id, doctor_id: userId },
    });
    if (!template) {
      throw new NotFoundException('Template não encontrado ou sem permissão.');
    }
    await templateRepo.remove(template);
  }
}
