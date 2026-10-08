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

/**
 * Índice único parcial em `patients.photo_path` (migration
 * `AddUniquePatientPhotoPath1755801100000`). Fecha a corrida do `fotoEmUso`,
 * que é check-then-write: duas gravações simultâneas com o mesmo caminho
 * passariam as duas pela checagem.
 */
export const UQ_PATIENTS_PHOTO_PATH = 'UQ_patients_photo_path';

/** Paciente como sai nas respostas HTTP: com a URL assinada da foto. */
export type PatientWithPhoto = Patient & { photoUrl: string | null };

/** Campo de texto opcional: vazio ou só espaços vira `null`, nunca `''`. */
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

    // Busca + paginação server-side num único round-trip (P6/P7). O `total`
    // reflete o filtro aplicado, permitindo paginação correta no frontend.
    const [records, total] =
      await this.patientRepository.findAndCountWithSearch(
        ownerId,
        query.search,
        query.skip ?? 0,
        query.take ?? 10,
      );

    return { total, records: await this.comFotos(records) };
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
    auditProntuarioAccess({
      resource: 'patient',
      resourceId: id,
      action: 'read',
      actorUserId: userId,
      tenantId: patient.ownerId,
    });
    return patient;
  }

  /**
   * `findOne` + URL assinada da foto, para a resposta HTTP. O `findOne` puro
   * continua sem a URL porque também é usado pela tool do assistente de
   * WhatsApp, que repassa o paciente ao modelo — URL assinada não vai para a
   * OpenAI.
   */
  async findOneWithPhoto(
    id: string,
    userId: string,
  ): Promise<PatientWithPhoto> {
    return this.comFoto(await this.findOne(id, userId));
  }

  /**
   * Resposta HTTP do create: mesmo formato do `findOneWithPhoto`, para quem
   * cadastra com foto já receber a URL. O `create` puro fica sem ela pelo
   * mesmo motivo do `findOne` (é o que o assistente de WhatsApp usa).
   */
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

    // Troca de foto: a antiga a apagar é a que o UPDATE de fato substituiu,
    // não a lida lá em cima (o script de conversão pode tê-la trocado no
    // meio — apagar a lida deixaria a WebP dele órfã no bucket).
    const substituida = await this.traduzirFotoDuplicada(() =>
      this.gravarTrocandoFoto(id, updateData),
    );
    if (substituida) await this.apagarFotoAntiga(substituida);

    return (await this.patientRepository.findOne({ id }))!;
  }

  /** Resposta HTTP do update: mesmo formato do `findOneWithPhoto`. */
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

  /**
   * Só aceita foto enviada por esta conta para a pasta de fotos de paciente.
   * Sem isso, um caminho de outro tenant (ou de outra pasta, como `documents/`)
   * gravado aqui viraria uma URL assinada gerada pelo próprio backend, por fora
   * da checagem de posse do `UploadService.getSignedUrl`.
   *
   * Também recusa a foto que já é de OUTRO paciente: trocar a foto de um apaga
   * o objeto antigo do bucket, e o outro ficaria apontando para o nada.
   */
  private async validarFoto(
    photoPath: string | null | undefined,
    ownerId: string,
    patientId?: string,
  ): Promise<string | null> {
    const caminho = textoOuNulo(photoPath);
    if (!caminho) return null;

    this.assertFotoDaConta(caminho, ownerId);
    if (await this.fotoEmUso(caminho, patientId)) {
      throw new BadRequestException('Foto do paciente inválida.');
    }
    return caminho;
  }

  /** Caminho direto em `patient-photos/<ownerId>/`, sem subpasta nem `..`. */
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

  /**
   * Descarta uma foto que o front enviou mas não chegou a usar: o `PATCH` da
   * troca falhou, ou o cadastro do paciente falhou e o modal foi fechado. Sem
   * isso, o objeto (dado de saúde) ficava no bucket até a varredura diária
   * (`FotosPacienteOrfasService`).
   *
   * Não é um "apagar arquivo" genérico: só aceita caminho na pasta de fotos
   * DA CONTA de quem chama, e não faz nada se algum paciente (inclusive
   * excluído) referencia o caminho — então não serve para apagar a foto de um
   * paciente existente, nem a de outro tenant. Idempotente e silencioso: o
   * front chama em best-effort e não tem o que fazer com um erro.
   */
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

  /**
   * O índice único de `photo_path` recusou a gravação: outra requisição
   * gravou o mesmo caminho entre o `fotoEmUso` e o INSERT/UPDATE. Mesma
   * resposta do `validarFoto` — para o cliente é o mesmo caso.
   */
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

  /**
   * Algum paciente (fora `excetoId`) aponta para este caminho? Conta também os
   * excluídos (soft delete): um paciente restaurado não pode voltar sem foto.
   */
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

  /**
   * Grava o update com `SELECT … FOR UPDATE` na linha: lê o `photo_path`
   * vigente e troca dentro da mesma transação, então ninguém (o script de
   * conversão, outro save da tela) troca a foto entre a leitura e a escrita.
   * Devolve o caminho efetivamente substituído (ou `null` se não havia foto
   * ou ela não mudou) — esse, e só esse, é candidato a sair do bucket.
   */
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
      // Foto que sumiu do storage não pode derrubar a ficha do paciente.
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

  /**
   * Best-effort: o cadastro já foi gravado; objeto órfão no R2 não é erro.
   * Não apaga objeto que outro paciente ainda referencia (foto compartilhada
   * gravada antes da checagem do `validarFoto`, ou importação antiga).
   */
  private async apagarFotoAntiga(photoPath: string): Promise<void> {
    try {
      if (await this.fotoEmUso(photoPath)) return;
      await this.storageService.delete(photoPath);
    } catch {
      this.logger.warn('Falha ao apagar foto antiga de paciente do storage');
    }
  }
}
