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

/** Campos clínicos que o modelo carrega para dentro da ficha. */
const CLINICAL_FIELDS = [
  'anamnesis',
  'physicalExam',
  'diagnosis',
  'conduct',
  'cidCodes',
] as const;

/**
 * Modelos de anamnese — o texto-base que o médico reaproveita a cada
 * atendimento. Aplicar um modelo é só devolver os campos: quem escreve na
 * ficha é o frontend, então o modelo nunca altera um atendimento já gravado.
 */
@Injectable()
export class ClinicalRecordTemplatesService {
  constructor(
    private readonly templateRepository: ClinicalRecordTemplateRepository,
    private readonly accessControlService: AccessControlService,
  ) {}

  /** Modelos da clínica, opcionalmente filtrados por médico. */
  async findMany(
    userId: string,
    doctorId?: string,
  ): Promise<ClinicalRecordTemplate[]> {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    return this.templateRepository.findByOwner(ownerId, doctorId);
  }

  async create(
    data: CreateClinicalRecordTemplateDto,
    userId: string,
  ): Promise<ClinicalRecordTemplate> {
    await this.accessControlService.assertIsDoctor(userId);
    const ownerId = await this.accessControlService.getOwnerId(userId);

    const doctorId =
      data.doctorId ??
      (await this.accessControlService.resolveDefaultDoctorId(userId));
    const canAccess = await this.accessControlService.canAccessDoctor(
      userId,
      doctorId,
    );
    if (!canAccess) {
      throw new ForbiddenException('Médico não acessível para esta operação.');
    }

    return this.templateRepository.create({
      ownerId,
      doctorId,
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
    await this.getEditable(id, userId);

    // Só o que veio no corpo — string vazia é uma limpeza intencional do campo.
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
    await this.getEditable(id, userId);
    await this.templateRepository.delete(id);
  }

  /**
   * Devolve o modelo para preencher a ficha e conta o uso.
   *
   * Aplicar é o primeiro passo de escrever na ficha, então também é ato do
   * médico. Não é uma fronteira de confidencialidade — `findMany` já devolve o
   * texto do modelo para quem tem `atendimento` —, mas é uma escrita: o
   * contador de uso é a estatística de qual texto-base aquele médico
   * realmente usa, e quem não pode escrever na ficha não deveria estar
   * carimbando esse número. O recorte de clínica continua valendo por cima.
   */
  async apply(id: string, userId: string): Promise<ClinicalRecordTemplate> {
    await this.accessControlService.assertIsDoctor(userId);
    const template = await this.getOwned(id, userId);
    await this.templateRepository.incrementUsage(id);
    return template;
  }

  private async getOwned(
    id: string,
    userId: string,
  ): Promise<ClinicalRecordTemplate> {
    const template = await this.templateRepository.findOne({ id });
    if (!template) throw new NotFoundException('Modelo não encontrado');
    await this.accessControlService.assertSameOwner(userId, template.ownerId);
    return template;
  }

  /**
   * Alterar ou excluir exige **ser médico** e ter acesso ao médico dono do
   * modelo — as duas coisas, como em `create`.
   *
   * O recorte por médico sozinho não bastava: a secretária vinculada ao médico
   * M1 passava por ele e reescrevia (ou apagava) o texto-base clínico gravado
   * em nome do M1. Modelo de anamnese é conteúdo clínico assinado pelo médico;
   * escrever nele é ato do médico, igual à ficha (`assertCanWriteRecord`) e à
   * emissão de receita/atestado. Ler continua liberado para quem tem
   * `atendimento` — `findMany` não passa por aqui.
   */
  private async getEditable(
    id: string,
    userId: string,
  ): Promise<ClinicalRecordTemplate> {
    await this.accessControlService.assertIsDoctor(userId);
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
