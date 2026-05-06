import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ReportSection } from 'src/database/entities/report-section.entity';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { CreateReportSectionDto } from '../dto/create-report-section.dto';
import { UpdateReportSectionDto } from '../dto/update-report-section.dto';
import { ReorderReportSectionsDto } from '../dto/reorder-report-sections.dto';
import { SurgeryRequestPdfAssemblyService } from './surgery-request-pdf-assembly.service';

@Injectable()
export class SurgeryRequestReportService {
  private readonly logger = new Logger(SurgeryRequestReportService.name);

  constructor(
    @InjectRepository(ReportSection)
    private readonly reportSectionRepository: Repository<ReportSection>,
    private readonly surgeryRequestRepository: SurgeryRequestRepository,
    private readonly pdfAssemblyService: SurgeryRequestPdfAssemblyService,
    private readonly dataSource: DataSource,
  ) {}

  getReportSections(id: string, _userId: string): Promise<ReportSection[]> {
    return this.reportSectionRepository.find({
      where: { surgery_request_id: id },
      order: { order: 'ASC' },
    });
  }

  async createReportSection(
    id: string,
    dto: CreateReportSectionDto,
    _userId: string,
  ): Promise<ReportSection> {
    const count = await this.reportSectionRepository.count({
      where: { surgery_request_id: id },
    });
    const section = this.reportSectionRepository.create({
      surgery_request_id: id,
      title: dto.title,
      description: dto.description ?? null,
      order: count,
    });
    return this.reportSectionRepository.save(section);
  }

  async updateReportSection(
    _id: string,
    sectionId: string,
    dto: UpdateReportSectionDto,
    _userId: string,
  ): Promise<ReportSection> {
    const section = await this.reportSectionRepository.findOne({
      where: { id: sectionId },
    });
    if (!section) throw new NotFoundException('Seção não encontrada');
    if (dto.title !== undefined) section.title = dto.title;
    if (dto.description !== undefined) section.description = dto.description;
    return this.reportSectionRepository.save(section);
  }

  async deleteReportSection(
    _id: string,
    sectionId: string,
    _userId: string,
  ): Promise<{ deleted: boolean }> {
    const result = await this.reportSectionRepository.delete({ id: sectionId });
    return { deleted: (result.affected ?? 0) > 0 };
  }

  async reorderReportSections(
    id: string,
    dto: ReorderReportSectionsDto,
    _userId: string,
  ): Promise<ReportSection[]> {
    if (dto.ids.length === 0) return this.getReportSections(id, _userId);

    // Batch update via VALUES: 1 round-trip ao banco em vez de N
    const rows = dto.ids
      .map((_, index) => `($${index * 2 + 1}::uuid, $${index * 2 + 2}::int)`)
      .join(', ');
    const params = dto.ids.flatMap((sectionId, index) => [sectionId, index]);
    const surgeryRequestParam = `$${params.length + 1}`;

    await this.dataSource.query(
      `UPDATE report_section rs
       SET "order" = v.new_order
       FROM (VALUES ${rows}) AS v(id, new_order)
       WHERE rs.id = v.id AND rs.surgery_request_id = ${surgeryRequestParam}`,
      [...params, id],
    );

    return this.getReportSections(id, _userId);
  }

  async generateReportPdf(id: string, userId: string): Promise<Buffer> {
    const request = await this.surgeryRequestRepository.findOneWithAllRelations(
      { id },
    );
    if (!request) throw new NotFoundException('Solicitação não encontrada');

    const { pdf } = await this.pdfAssemblyService.generateLaudoPdf(
      request,
      userId,
    );
    return Buffer.from(pdf, 'base64');
  }
}
