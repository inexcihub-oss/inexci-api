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

@Injectable()
export class ClinicalSnippetsService {
  constructor(
    private readonly snippetRepository: ClinicalSnippetRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  async findMany(
    userId: string,
    doctorId?: string,
  ): Promise<ClinicalSnippet[]> {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const alvo = await this.resolveDoctor(userId, doctorId);
    return this.snippetRepository.findByDoctor(ownerId, alvo);
  }

  async create(
    data: CreateClinicalSnippetDto,
    userId: string,
  ): Promise<ClinicalSnippet> {
    await this.accessControlService.assertIsDoctor(userId);
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const doctorId = await this.resolveDoctor(userId, data.doctorId);

    if (await this.snippetRepository.shortcutInUse(doctorId, data.shortcut)) {
      throw new ConflictException(ATALHO_EM_USO);
    }

    return this.snippetRepository.create({
      ownerId,
      doctorId,
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
    const snippet = await this.getEditable(id, userId);

    if (
      data.shortcut !== undefined &&
      data.shortcut !== snippet.shortcut &&
      (await this.snippetRepository.shortcutInUse(
        snippet.doctorId,
        data.shortcut,
        id,
      ))
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
    await this.getEditable(id, userId);
    await this.snippetRepository.delete(id);
  }

  async registerUse(id: string, userId: string): Promise<void> {
    await this.getEditable(id, userId);
    await this.snippetRepository.incrementUsage(id);
  }

  private async resolveDoctor(
    userId: string,
    doctorId?: string,
  ): Promise<string> {
    const alvo =
      doctorId ??
      (await this.accessControlService.resolveDefaultDoctorId(userId));
    const canAccess = await this.accessControlService.canAccessDoctor(
      userId,
      alvo,
    );
    if (!canAccess) {
      throw new ForbiddenException('Médico não acessível para esta operação.');
    }
    return alvo;
  }

  private async getEditable(
    id: string,
    userId: string,
  ): Promise<ClinicalSnippet> {
    await this.accessControlService.assertIsDoctor(userId);
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const snippet = await this.snippetRepository.findOne({ id, ownerId });
    if (!snippet) throw new NotFoundException('Texto rápido não encontrado');
    await this.accessControlService.assertCanAccessDoctorResource(
      userId,
      snippet.ownerId,
      snippet.doctorId,
    );
    return snippet;
  }
}
