import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as sanitizeHtml from 'sanitize-html';
import { ReportSection } from 'src/database/entities/report-section.entity';
import { SurgeryRequestRepository } from 'src/database/repositories/surgery-request.repository';
import { CreateReportSectionDto } from '../dto/create-report-section.dto';
import { UpdateReportSectionDto } from '../dto/update-report-section.dto';
import { ReorderReportSectionsDto } from '../dto/reorder-report-sections.dto';
import { SurgeryRequestPdfAssemblyService } from './surgery-request-pdf-assembly.service';
import { upsertClinicalReportSection } from '../utils/clinical-report-sections.util';

const SECTION_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['b', 'i', 'u', 'strong', 'em', 'p', 'br', 'ul', 'ol', 'li'],
  allowedAttributes: {},
  disallowedTagsMode: 'discard',
};

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
      where: { surgeryRequestId: id },
      order: { order: 'ASC' },
    });
  }

  async createReportSection(
    id: string,
    dto: CreateReportSectionDto,
    _userId: string,
  ): Promise<ReportSection> {
    const count = await this.reportSectionRepository.count({
      where: { surgeryRequestId: id },
    });
    const section = this.reportSectionRepository.create({
      surgeryRequestId: id,
      title: sanitizeHtml(dto.title, SECTION_SANITIZE_OPTIONS),
      description: dto.description
        ? sanitizeHtml(dto.description, SECTION_SANITIZE_OPTIONS)
        : null,
      order: count,
    });
    return this.reportSectionRepository.save(section);
  }

  async updateReportSection(
    surgeryRequestId: string,
    sectionId: string,
    dto: UpdateReportSectionDto,
    _userId: string,
  ): Promise<ReportSection> {
    // Escopo por SC obrigatório: o SurgeryRequestOwnerGuard valida apenas o
    // :id (a SC) contra o tenant; sem amarrar a seção à SC, um atacante usaria
    // uma SC própria no :id e o sectionId de outra clínica — IDOR cross-tenant.
    const section = await this.reportSectionRepository.findOne({
      where: { id: sectionId, surgeryRequestId },
    });
    if (!section) throw new NotFoundException('Seção não encontrada');
    if (dto.title !== undefined)
      section.title = sanitizeHtml(dto.title, SECTION_SANITIZE_OPTIONS);
    if (dto.description !== undefined)
      section.description =
        dto.description !== null
          ? sanitizeHtml(dto.description, SECTION_SANITIZE_OPTIONS)
          : null;
    return this.reportSectionRepository.save(section);
  }

  async upsertReportSectionByTitle(
    surgeryRequestId: string,
    title: string,
    description: string,
  ): Promise<void> {
    await upsertClinicalReportSection(
      this.reportSectionRepository,
      surgeryRequestId,
      title,
      description,
    );
  }

  async deleteReportSection(
    surgeryRequestId: string,
    sectionId: string,
    _userId: string,
  ): Promise<{ deleted: boolean }> {
    // Escopo por SC obrigatório — mesmo motivo de updateReportSection: evita
    // apagar seção de laudo de outro tenant via sectionId não escopado.
    const result = await this.reportSectionRepository.delete({
      id: sectionId,
      surgeryRequestId,
    });
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
      `UPDATE report_sections rs
       SET "order" = v.new_order
       FROM (VALUES ${rows}) AS v(id, new_order)
       WHERE rs.id = v.id AND rs.surgery_request_id = ${surgeryRequestParam}`,
      [...params, id],
    );

    return this.getReportSections(id, _userId);
  }

  async generateMedicalReportPdf(id: string, userId: string): Promise<Buffer> {
    const request = await this.surgeryRequestRepository.findOneWithAllRelations(
      { id },
    );
    if (!request) throw new NotFoundException('Solicitação não encontrada');

    return this.pdfAssemblyService.generateMedicalReportPdf(request, userId);
  }
}
