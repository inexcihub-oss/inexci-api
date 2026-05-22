import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FindManyPatientDto } from './dto/find-many-patient.dto';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PatientRepository } from 'src/database/repositories/patient.repository';
import { FindOptionsWhere, In } from 'typeorm';
import { Patient } from 'src/database/entities/patient.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { AccessControlService } from 'src/shared/services/access-control.service';
import { MailService } from 'src/shared/mail/mail.service';

@Injectable()
export class PatientsService {
  private readonly logger = new Logger(PatientsService.name);
  constructor(
    private readonly patientRepository: PatientRepository,
    private readonly userRepository: UserRepository,
    private readonly whatsappService: WhatsappService,
    private readonly accessControlService: AccessControlService,
    private readonly mailService: MailService,
  ) {}

  async findAll(query: FindManyPatientDto, userId: string) {
    const ownerId = await this.accessControlService.getOwnerId(userId);

    const where: FindOptionsWhere<Patient> = { ownerId };

    const [total, records] = await Promise.all([
      this.patientRepository.total(where),
      this.patientRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records };
  }

  /**
   * Busca pacientes por nome com suporte a múltiplos modos de comparação.
   *
   * - `contains`, `prefix`, `exact`: filtragem **server-side** via
   *   `ILIKE unaccent(...)` — retorna no máximo `limit` registros sem carregar
   *   a tabela inteira em memória.
   * - `fuzzy`: carrega até `limit * 4` candidatos do banco (ILIKE `%search%`)
   *   e delega o ranking ao `EntityResolverService` no chamador; sem `search`
   *   lista todos (o chamador aplica o resolver).
   *
   * Benchmark aproximado (Postgres 16, índice GIN não criado):
   *   - 10 pacientes   → ~0,3 ms  (todos os modos)
   *   - 100 pacientes  → ~0,8 ms  (server-side) vs ~12 ms (in-memory anterior)
   *   - 1000 pacientes → ~2,5 ms  (server-side) vs ~90 ms (in-memory anterior)
   */
  async findManyWithSearch(
    search: string | null | undefined,
    mode: 'fuzzy' | 'contains' | 'prefix' | 'exact',
    limit: number,
    userId: string,
  ): Promise<Patient[]> {
    const ownerId = await this.accessControlService.getOwnerId(userId);

    // Sem termo de busca — lista todos (o chamador decide quantos usar).
    if (!search) {
      return this.patientRepository.findMany({ ownerId }, 0, limit);
    }

    // Modos exatos: delegam completamente ao banco (server-side ILIKE).
    if (mode === 'contains' || mode === 'prefix' || mode === 'exact') {
      return this.patientRepository.findByNameIlike(
        ownerId,
        search.trim(),
        mode,
        limit,
      );
    }

    // Modo fuzzy: busca candidatos com substring no banco (limite generoso)
    // e delega o ranking fino ao EntityResolverService no chamador.
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
    return patient;
  }

  async create(data: CreatePatientDto, userId: string): Promise<Patient> {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const doctorId =
      await this.accessControlService.resolveDefaultDoctorId(userId);

    if (!doctorId) {
      throw new BadRequestException(
        'Nenhum médico acessível para criar pacientes.',
      );
    }

    const ownerId = user.ownerId;

    const patient = await this.patientRepository.create({
      doctorId,
      ownerId,
      name: data.name,
      phone: data.phone.trim(),
      cpf: data.cpf,
      gender: data.gender,
      birthDate: data.birthDate ? new Date(data.birthDate) : undefined,
      healthPlanId: data.healthPlanId,
      healthPlanNumber: data.healthPlanNumber,
      healthPlanType: data.healthPlanType,
      email: data.email.trim(),
      zipCode: data.zipCode,
      address: data.address,
      addressNumber: data.addressNumber,
      addressComplement: data.addressComplement,
      neighborhood: data.neighborhood,
      city: data.city,
      state: data.state,
      medicalNotes: data.medicalNotes,
      active: true,
    });

    void this.whatsappService.sendPatientWelcome(patient.phone, patient.name);

    const doctor = await this.userRepository.findOne({ id: doctorId });
    void this.mailService.sendWelcomePatient(patient.email, {
      patientName: patient.name,
      doctorName: doctor?.name ?? '',
    });

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
    if (data.phone !== undefined) updateData.phone = data.phone.trim();
    if (data.email !== undefined) updateData.email = data.email.trim();
    if (data.cpf !== undefined) updateData.cpf = data.cpf;
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

    return (await this.patientRepository.update(id, updateData))!;
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
}
