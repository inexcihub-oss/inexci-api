import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClinicalSnippet } from 'src/database/entities/clinical-snippet.entity';
import { ClinicalSnippetRepository } from 'src/database/repositories/clinical-snippet.repository';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { CreateClinicalSnippetDto } from './dto/create-clinical-snippet.dto';
import { UpdateClinicalSnippetDto } from './dto/update-clinical-snippet.dto';

const ATALHO_EM_USO = 'Já existe um texto rápido com esse atalho.';
export const SOMENTE_PROPRIO_SNIPPET =
  'Você só pode criar e alterar os seus próprios textos rápidos.';

@Injectable()
export class ClinicalSnippetsService {
  constructor(
    private readonly snippetRepository: ClinicalSnippetRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async findMany(userId: string): Promise<ClinicalSnippet[]> {
    if (!(await this.accessControlService.isDoctor(userId))) return [];
    const ownerId = await this.accessControlService.getOwnerId(userId);
    return this.snippetRepository.findByDoctor(ownerId, userId);
  }

  async create(
    data: CreateClinicalSnippetDto,
    userId: string,
  ): Promise<ClinicalSnippet> {
    await this.accessControlService.assertIsDoctor(userId);
    if (data.doctorId !== undefined && data.doctorId !== userId) {
      throw new ForbiddenException(SOMENTE_PROPRIO_SNIPPET);
    }
    const ownerId = await this.accessControlService.getOwnerId(userId);

    if (await this.snippetRepository.shortcutInUse(userId, data.shortcut)) {
      throw new ConflictException(ATALHO_EM_USO);
    }

    return this.snippetRepository.create({
      ownerId,
      doctorId: userId,
      shortcut: data.shortcut,
      title: data.title.trim(),
      content: data.content,
    });
  }

  async update(
    id: string,
    data: UpdateClinicalSnippetDto,
    userId: string,
  ): Promise<ClinicalSnippet> {
    const snippet = await this.getProprio(id, userId);

    if (
      data.shortcut !== undefined &&
      data.shortcut !== snippet.shortcut &&
      (await this.snippetRepository.shortcutInUse(userId, data.shortcut, id))
    ) {
      throw new ConflictException(ATALHO_EM_USO);
    }

    const updateData: Partial<ClinicalSnippet> = {};
    if (data.shortcut !== undefined) updateData.shortcut = data.shortcut;
    if (data.title !== undefined) updateData.title = data.title.trim();
    if (data.content !== undefined) updateData.content = data.content;

    return (await this.snippetRepository.update(id, updateData))!;
  }

  async delete(id: string, userId: string): Promise<void> {
    await this.getProprio(id, userId);
    await this.snippetRepository.delete(id);
  }

  async registerUse(id: string, userId: string): Promise<void> {
    await this.getProprio(id, userId);
    await this.snippetRepository.incrementUsage(id);
  }

  private async getProprio(
    id: string,
    userId: string,
  ): Promise<ClinicalSnippet> {
    await this.accessControlService.assertIsDoctor(userId);
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const snippet = await this.snippetRepository.findOne({
      id,
      ownerId,
      doctorId: userId,
    });
    if (!snippet) throw new NotFoundException('Texto rápido não encontrado');
    return snippet;
  }
}
