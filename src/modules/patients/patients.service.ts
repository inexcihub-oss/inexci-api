import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FindManyPatientDto } from './dto/find-many-patient.dto';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { In, Not, QueryDeepPartialEntity } from 'typeorm';
import { Patient } from 'src/database/entities/patient.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { MailService } from 'src/shared/mail/mail.service';
import { auditProntuarioAccess } from 'src/shared/logging/audit';
import { StorageService } from 'src/shared/storage/storage.service';
import { STORAGE_FOLDERS } from 'src/config/storage.config';
import { violacaoDeUnicidade } from 'src/database/repositories/unique-violation.util';

export const UQ_PATIENTS_PHOTO_PATH = 'UQ_patients_photo_path';

export const FOTO_EXPIRADA = 'A foto enviada expirou; envie novamente.';

export type PatientWithPhoto = Patient & { photoUrl: string | null };

function textoOuNulo(valor: string | null | undefined): string | null {
  return valor?.trim() || null;
}

@Injectable()
export class PatientsService {
  private readonly logger = new Logger(PatientsService.name);
  constructor(
    private readonly patientRepository: PatientRepository,
    private readonly userRepository: UserRepository,
    private readonly whatsappService: WhatsappService,
    private readonly accessControlService: AccessControlService,
    private readonly mailService: MailService,
    private readonly storageService: StorageService,
  ) {}

  async findAll(query: FindManyPatientDto, userId: string) {
    const ownerId = await this.accessControlService.getOwnerId(userId);

    const [records, total] =
      await this.patientRepository.findAndCountWithSearch(
        ownerId,
        query.search,
        query.skip ?? 0,
        query.take ?? 10,
      );

    return { total, records: await this.comFotos(records) };
  }

  async findManyWithSearch(
    search: string | null | undefined,
    mode: 'fuzzy' | 'contains' | 'prefix' | 'exact',
    limit: number,
    userId: string,
  ): Promise<Patient[]> {
    const ownerId = await this.accessControlService.getOwnerId(userId);

    if (!search) {
      return this.patientRepository.findMany({ ownerId }, 0, limit);
    }

    if (mode === 'contains' || mode === 'prefix' || mode === 'exact') {
      return this.patientRepository.findByNameIlike(
        ownerId,
        search.trim(),
        mode,
        limit,
      );
    }

    const candidateLimit = Math.min(limit * 4, 100);
    return this.patientRepository.findByNameIlike(
      ownerId,
      search.trim(),
      'contains',
      candidateLimit,
    );
  }

  async findOne(id: string, userId: string): Promise<Patient> {
    const patient = await this.patientRepository.findOne({ id });
    if (!patient) throw new NotFoundException('Paciente não encontrado');
    await this.accessControlService.assertSameOwner(userId, patient.ownerId);
    auditProntuarioAccess({
      resource: 'patient',
      resourceId: id,
      action: 'read',
      actorUserId: userId,
      tenantId: patient.ownerId,
    });
    return patient;
  }

  async findOneWithPhoto(
    id: string,
    userId: string,
  ): Promise<PatientWithPhoto> {
    return this.comFoto(await this.findOne(id, userId));
  }

  async createWithPhoto(
    data: CreatePatientDto,
    userId: string,
  ): Promise<PatientWithPhoto> {
    return this.comFoto(await this.create(data, userId));
  }

  async create(data: CreatePatientDto, userId: string): Promise<Patient> {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const ownerId = user.ownerId;
    const doctorId = ownerId;
    const photoPath = await this.validarFoto(data.photoPath, ownerId);

    const patient = await this.traduzirFotoDuplicada(() =>
      this.patientRepository.create({
        doctorId,
        ownerId,
        name: data.name,
        phone: data.phone?.trim() || null,
        secondaryPhone: textoOuNulo(data.secondaryPhone),
        cpf: textoOuNulo(data.cpf),
        photoPath,
        gender: data.gender,
        birthDate: data.birthDate ? new Date(data.birthDate) : undefined,
        healthPlanId: data.healthPlanId,
        healthPlanNumber: data.healthPlanNumber,
        healthPlanType: data.healthPlanType,
        email: data.email?.trim() || null,
        zipCode: data.zipCode,
        address: data.address,
        addressNumber: data.addressNumber,
        addressComplement: data.addressComplement,
        neighborhood: data.neighborhood,
        city: data.city,
        state: data.state,
        medicalNotes: data.medicalNotes,
        active: true,
      }),
    );

    if (patient.phone) {
      void this.whatsappService.sendPatientWelcome(patient.phone, patient.name);
    }

    const doctor = await this.userRepository.findOne({ id: ownerId });
    if (patient.email) {
      void this.mailService.sendWelcomePatient(patient.email, {
        patientName: patient.name,
        doctorName: doctor?.name ?? '',
      });
    }

    return patient;
  }

  async update(
    id: string,
    data: UpdatePatientDto,
    userId: string,
  ): Promise<Patient> {
    const patient = await this.patientRepository.findOne({ id });
    if (!patient) throw new NotFoundException('Paciente não encontrado');
    await this.accessControlService.assertSameOwner(userId, patient.ownerId);

    const updateData: Partial<Patient> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.phone !== undefined) updateData.phone = data.phone.trim() || null;
    if (data.email !== undefined) updateData.email = data.email.trim() || null;
    if (data.cpf !== undefined) updateData.cpf = textoOuNulo(data.cpf);
    if (data.secondaryPhone !== undefined)
      updateData.secondaryPhone = textoOuNulo(data.secondaryPhone);
    if (data.photoPath !== undefined)
      updateData.photoPath = await this.validarFoto(
        data.photoPath,
        patient.ownerId,
        id,
        patient.photoPath,
      );
    if (data.gender !== undefined) updateData.gender = data.gender;
    if (data.birthDate !== undefined)
      updateData.birthDate = new Date(data.birthDate);
    if (data.healthPlanId !== undefined)
      updateData.healthPlanId = data.healthPlanId;
    if (data.healthPlanNumber !== undefined)
      updateData.healthPlanNumber = data.healthPlanNumber;
    if (data.healthPlanType !== undefined)
      updateData.healthPlanType = data.healthPlanType;
    if (data.zipCode !== undefined) updateData.zipCode = data.zipCode;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.addressNumber !== undefined)
      updateData.addressNumber = data.addressNumber;
    if (data.addressComplement !== undefined)
      updateData.addressComplement = data.addressComplement;
    if (data.neighborhood !== undefined)
      updateData.neighborhood = data.neighborhood;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.medicalNotes !== undefined)
      updateData.medicalNotes = data.medicalNotes;

    if (updateData.photoPath === undefined) {
      return (await this.patientRepository.update(id, updateData))!;
    }

    const substituida = await this.traduzirFotoDuplicada(() =>
      this.gravarTrocandoFoto(id, updateData),
    );
    if (substituida) await this.apagarFotoAntiga(substituida);

    return (await this.patientRepository.findOne({ id }))!;
  }

  async updateWithPhoto(
    id: string,
    data: UpdatePatientDto,
    userId: string,
  ): Promise<PatientWithPhoto> {
    return this.comFoto(await this.update(id, data, userId));
  }

  async delete(id: string, userId: string): Promise<void> {
    const patient = await this.patientRepository.findOne({ id });
    if (!patient) throw new NotFoundException('Paciente não encontrado');
    await this.accessControlService.assertSameOwner(userId, patient.ownerId);
    await this.patientRepository.delete(id);
  }

  async bulkDelete(
    ids: string[],
    userId: string,
  ): Promise<{ deleted: number }> {
    const ownerId = await this.accessControlService.getOwnerId(userId);
    const uniqueIds = [...new Set(ids)];

    const patients = await this.patientRepository.findMany({
      id: In(uniqueIds),
      ownerId,
    });

    if (patients.length !== uniqueIds.length) {
      throw new NotFoundException(
        'Um ou mais pacientes não foram encontrados.',
      );
    }

    await this.patientRepository.getRepository().softDelete(uniqueIds);
    this.logger.log(
      `Pacientes soft-deleted em lote: total=${uniqueIds.length}`,
    );

    return { deleted: uniqueIds.length };
  }

  private async validarFoto(
    photoPath: string | null | undefined,
    ownerId: string,
    patientId?: string,
    fotoAtual?: string | null,
  ): Promise<string | null> {
    const caminho = textoOuNulo(photoPath);
    if (!caminho) return null;

    this.assertFotoDaConta(caminho, ownerId);
    if (await this.fotoEmUso(caminho, patientId)) {
      throw new BadRequestException('Foto do paciente inválida.');
    }
    if (caminho !== fotoAtual && !(await this.fotoNoBucket(caminho))) {
      throw new BadRequestException(FOTO_EXPIRADA);
    }
    return caminho;
  }

  private async fotoNoBucket(caminho: string): Promise<boolean> {
    try {
      return await this.storageService.exists(caminho);
    } catch {
      throw new ServiceUnavailableException(
        'Não foi possível confirmar a foto enviada. Tente novamente.',
      );
    }
  }

  private assertFotoDaConta(caminho: string, ownerId: string): void {
    const prefixo = `${STORAGE_FOLDERS.PATIENT_PHOTOS}/${ownerId}/`;
    const nome = caminho.slice(prefixo.length);
    if (
      !caminho.startsWith(prefixo) ||
      !nome ||
      nome.includes('/') ||
      nome.includes('..')
    ) {
      throw new BadRequestException('Foto do paciente inválida.');
    }
  }

  async descartarFotoNaoUsada(
    photoPath: string,
    userId: string,
  ): Promise<void> {
    const caminho = textoOuNulo(photoPath);
    if (!caminho) throw new BadRequestException('Foto do paciente inválida.');
    const ownerId = await this.accessControlService.getOwnerId(userId);
    this.assertFotoDaConta(caminho, ownerId);
    if (await this.fotoEmUso(caminho)) return;
    try {
      await this.storageService.delete(caminho);
    } catch {
      this.logger.warn('Falha ao descartar foto de paciente não usada');
    }
  }

  private async traduzirFotoDuplicada<T>(gravar: () => Promise<T>): Promise<T> {
    try {
      return await gravar();
    } catch (erro) {
      if (violacaoDeUnicidade(erro)?.constraint === UQ_PATIENTS_PHOTO_PATH) {
        throw new BadRequestException('Foto do paciente inválida.');
      }
      throw erro;
    }
  }

  private async fotoEmUso(
    photoPath: string,
    excetoId?: string,
  ): Promise<boolean> {
    const total = await this.patientRepository.getRepository().count({
      where: excetoId ? { photoPath, id: Not(excetoId) } : { photoPath },
      withDeleted: true,
    });
    return total > 0;
  }

  private gravarTrocandoFoto(
    id: string,
    updateData: Partial<Patient>,
  ): Promise<string | null> {
    return this.patientRepository
      .getRepository()
      .manager.transaction(async (em) => {
        const repo = em.getRepository(Patient);
        const atual = await repo.findOne({
          where: { id },
          select: { id: true, photoPath: true },
          lock: { mode: 'pessimistic_write' },
        });
        await repo.update(id, updateData as QueryDeepPartialEntity<Patient>);
        const antiga = atual?.photoPath ?? null;
        return antiga && antiga !== updateData.photoPath ? antiga : null;
      });
  }

  private async urlDaFoto(photoPath: string | null): Promise<string | null> {
    if (!photoPath) return null;
    try {
      return await this.storageService.getSignedUrl(photoPath);
    } catch {
      this.logger.warn('Falha ao gerar URL da foto de paciente');
      return null;
    }
  }

  private async comFoto(paciente: Patient): Promise<PatientWithPhoto> {
    return { ...paciente, photoUrl: await this.urlDaFoto(paciente.photoPath) };
  }

  private async comFotos(pacientes: Patient[]): Promise<PatientWithPhoto[]> {
    return Promise.all(pacientes.map((p) => this.comFoto(p)));
  }

  private async apagarFotoAntiga(photoPath: string): Promise<void> {
    try {
      if (await this.fotoEmUso(photoPath)) return;
      await this.storageService.delete(photoPath);
    } catch {
      this.logger.warn('Falha ao apagar foto antiga de paciente do storage');
    }
  }
}
