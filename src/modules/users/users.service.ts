import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import * as sanitizeHtml from 'sanitize-html';
import { FindOptionsWhere, Not, In, QueryFailedError } from 'typeorm';
import {
  BadRequestException,
  Logger,
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { CreateUserDto } from './dto/create-user.dto';
import { FindManyUsersDto } from './dto/find-many.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateDoctorProfileDto } from './dto/create-doctor-profile.dto';
import { CreateCollaboratorDto } from './dto/create-collaborator.dto';
import { UpdateCollaboratorDto } from './dto/update-collaborator.dto';
import { UpdateDoctorProfileDto } from './dto/update-doctor-profile.dto';
import { UpsertDoctorHeaderDto } from './dto/upsert-doctor-header.dto';

import { UserRepository } from 'src/database/repositories/user.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { DoctorHeaderRepository } from 'src/database/repositories/doctor-header.repository';
import {
  Permission,
  resolveEffectivePermissions,
} from 'src/shared/permissions';
import { MailService } from 'src/shared/mail/mail.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { BCRYPT_ROUNDS } from 'src/shared/constants/bcrypt';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { User, UserRole, UserStatus } from 'src/database/entities/user.entity';
import { DoctorProfile } from 'src/database/entities/doctor-profile.entity';
import { UserDoctorAccessRepository } from 'src/database/repositories/user-doctor-access.repository';
import { UserDoctorAccessStatus } from 'src/database/entities/user-doctor-access.entity';
import { RecoveryCodeRepository } from 'src/database/repositories/recovery-code.repository';
import { RefreshTokenStore } from '../auth/refresh-token.store';

import { generateValidationCode } from 'src/shared/utils';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  constructor(
    private readonly userRepository: UserRepository,
    private readonly mailService: MailService,
    private readonly userDoctorAccessRepository: UserDoctorAccessRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
    private readonly recoveryCodeRepository: RecoveryCodeRepository,
    private readonly storageService: StorageService,
    private readonly whatsappService: WhatsappService,
    private readonly configService: ConfigService,
    private readonly doctorHeaderRepository: DoctorHeaderRepository,
    private readonly refreshTokenStore: RefreshTokenStore,
    // Opcional: só usado para emitir `user.access_changed` (invalida os
    // caches de identidade/autorização do assistente do WhatsApp). Manter
    // opcional evita acoplar este service ao módulo de IA e não quebra a
    // instanciação manual usada nos testes unitários deste arquivo.
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  /**
   * Emite `user.access_changed` para que o assistente do WhatsApp invalide
   * os caches em memória que derivam a permissão efetiva de um usuário
   * (`AiOrchestratorService.onUserAccessChanged`). Cobre TODAS as mutações
   * que alteram o que um colaborador pode fazer pelo WhatsApp — não só
   * `permissions`/`doctor_profile` (nome antigo do evento,
   * `user.permissions_changed`), mas também exclusão e desativação, daí o
   * nome mais amplo.
   *
   * `phone` precisa ser o telefone ORIGINAL do usuário — em
   * `deleteCollaborator`/`bulkDeleteCollaborators` o telefone já foi
   * trocado por uma sentinela no banco antes deste ponto, então invalidar
   * com o telefone atual não limparia a entrada certa do cache (que ainda
   * está indexada pelo telefone antigo).
   */
  private emitAccessChanged(userId: string, phone: string | null | undefined) {
    this.eventEmitter?.emit('user.access_changed', { userId, phone });
  }

  /**
   * Gerir a equipe é ato de quem tem Administração — o dono da conta ou o
   * colaborador a quem ele delegou. Não basta o role: o admin delegado
   * continua sendo `collaborator`. Devolve o usuário carregado (em vez de
   * `void`) para que os 11 chamadores não precisem refazer um `findOne` do
   * mesmo id logo em seguida.
   */
  private async assertPodeGerirEquipe(userId: string): Promise<User> {
    const usuario = await this.userRepository.findOneWithProfile({
      id: userId,
    });
    if (!usuario) throw new NotFoundException('Usuário não encontrado');

    const permissoes = resolveEffectivePermissions({
      role: usuario.role,
      permissions: usuario.permissions,
      isDoctor: !!usuario.doctorProfile,
    });

    if (!permissoes.includes(Permission.ADMINISTRACAO)) {
      throw new ForbiddenException(
        'Você não tem permissão para gerenciar colaboradores.',
      );
    }

    return usuario;
  }

  /**
   * O dono da conta não é gerenciável por ninguém: é quem paga a assinatura e
   * a raiz do tenant (`ownerId = self.id`). Um admin delegado que pudesse
   * desativá-lo tomaria a clínica.
   */
  private assertAlvoNaoEhDono(alvo: { id: string; ownerId: string }): void {
    if (alvo.id === alvo.ownerId) {
      throw new ForbiddenException(
        'O dono da conta não pode ser alterado por outro usuário.',
      );
    }
  }

  /**
   * Lista usuários
   * - Admin: pode ver todos da conta
   * - Médico (com doctorProfile): pode ver quem tem acesso via user_doctor_access
   * - Colaborador: só pode ver a si mesmo
   */
  async findMany(query: FindManyUsersDto, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const where: FindOptionsWhere<User> = {};

    // Admin pode ver todos da conta
    if (user.role === UserRole.ADMIN) {
      where.ownerId = user.ownerId;
      if (query.role) {
        where.role = query.role;
      }
    } else {
      // Verificar se é médico (tem doctorProfile) - pode ver quem tem acesso
      const doctorProfile =
        await this.doctorProfileRepository.findByUserId(userId);
      if (doctorProfile) {
        const accesses =
          await this.userDoctorAccessRepository.findActiveByDoctorUserId(
            userId,
          );
        const accessUserIds = accesses.map((a) => a.userId);
        where.id = In([userId, ...accessUserIds]);
      } else {
        // Colaboradores só podem ver a si mesmos
        where.id = userId;
      }
      if (query.role) {
        where.role = query.role;
      }
    }

    const [total, resp] = await Promise.all([
      this.userRepository.total(where),
      this.userRepository.findMany(where, query.skip ?? 0, query.take ?? 20),
    ]);

    return { total, records: resp };
  }

  async findOne(id: string, userId: string) {
    if (!id) throw new BadRequestException('ID é obrigatório');

    const requestingUser = await this.userRepository.findOne({ id: userId });
    if (!requestingUser) throw new NotFoundException('Usuário não encontrado');

    let user: Awaited<ReturnType<typeof this.userRepository.findOne>>;

    // Admin pode ver qualquer um da conta
    if (requestingUser.role === UserRole.ADMIN) {
      // Escopo de tenant igual ao do findMany logo acima. Sem ownerId aqui,
      // qualquer conta (todo register cria um ADMIN) lia CPF, endereco e a
      // signed URL da assinatura de medicos de outras clinicas.
      user = await this.userRepository.findOne({
        id,
        ownerId: requestingUser.ownerId,
      });
      if (!user) throw new NotFoundException('Usuário não encontrado');
    } else {
      // Médico (com doctorProfile) pode ver a si mesmo ou quem tem acesso
      const doctorProfile =
        await this.doctorProfileRepository.findByUserId(userId);
      if (doctorProfile) {
        if (id !== userId) {
          const accesses =
            await this.userDoctorAccessRepository.findActiveByDoctorUserId(
              userId,
            );
          const accessUserIds = accesses.map((a) => a.userId);
          if (!accessUserIds.includes(id)) {
            throw new ForbiddenException('Sem permissão para ver este usuário');
          }
        }
      } else if (id !== userId) {
        throw new ForbiddenException('Sem permissão para ver este usuário');
      }

      user = await this.userRepository.findOne({ id });
      if (!user) throw new NotFoundException('Usuário não encontrado');
    }

    const [avatarUrl, signatureUrl] = await Promise.all([
      this.resolveStorageUrl(user.avatarUrl),
      this.resolveStorageUrl(user.doctorProfile?.signatureUrl),
    ]);

    // Spread de entidade escapa do ClassSerializerInterceptor: o interceptor
    // so aplica @Exclude() quando o objeto e instancia de classe. Campos
    // explicitos evitam vazar password/emailVerificationToken/etc.
    const result: Record<string, unknown> = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      cpf: user.cpf,
      // `char(1)` volta preenchido com espaço quando gravado vazio. Normaliza
      // na leitura para que registros antigos não devolvam `' '` ao formulário
      // — o valor voltaria no PATCH seguinte e seria recusado pelo DTO.
      gender: user.gender?.trim() || null,
      birthDate: user.birthDate,
      cep: user.cep,
      address: user.address,
      addressNumber: user.addressNumber,
      addressComplement: user.addressComplement,
      city: user.city,
      state: user.state,
      role: user.role,
      status: user.status,
      accountId: user.ownerId,
      doctorProfile: user.doctorProfile,
      avatarUrl,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
    if (user.doctorProfile) {
      result.doctorProfile = { ...user.doctorProfile, signatureUrl };
    }
    return result;
  }

  async getProfile(userId: string) {
    const user = await this.userRepository.findOneWithProfile({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    // Remove senha e campos internos (permissions cru e isPlatformAdmin) do
    // retorno — não são dados que a rota de perfil deve expor.
    const { password, permissions, isPlatformAdmin, ...userWithoutPassword } =
      user;

    // Gerar signed URL para assinatura do médico (bucket privado)
    const profile = userWithoutPassword.doctorProfile;
    if (profile?.signatureUrl && !profile.signatureUrl.startsWith('http')) {
      try {
        profile.signatureUrl = await this.storageService.getSignedUrl(
          profile.signatureUrl,
        );
      } catch {
        // manter path original se falhar
      }
    }

    return {
      ...userWithoutPassword,
      isDoctor: !!userWithoutPassword.doctorProfile,
      // A permissão EFETIVA, não a coluna crua: o frontend precisa saber o
      // que o usuário pode de fato, incluindo o que ganha por ser médico.
      permissions: resolveEffectivePermissions({
        role: userWithoutPassword.role,
        permissions,
        isDoctor: !!userWithoutPassword.doctorProfile,
      }),
    };
  }

  async updateProfile(data: UpdateProfileDto, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    // Verifica se o telefone já está em uso por outro usuário
    if (data.phone) {
      const phoneFound = await this.userRepository.findOne({
        phone: data.phone,
        id: Not(userId),
      });
      if (phoneFound) throw new BadRequestException('Telefone já está em uso');
    }

    // Verifica se o CPF já está em uso por outro usuário
    if (data.cpf) {
      const cpfFound = await this.userRepository.findOne({
        cpf: data.cpf,
        id: Not(userId),
      });
      if (cpfFound) throw new BadRequestException('CPF já está em uso');
    }

    // Campos do usuário base
    const userUpdates: Partial<User> = {};
    if (data.name) userUpdates.name = data.name;
    if (data.phone) userUpdates.phone = data.phone;
    if (data.cpf) userUpdates.cpf = data.cpf;
    if (data.birthDate) userUpdates.birthDate = new Date(data.birthDate);
    if (data.gender) userUpdates.gender = data.gender;
    if (data.avatarUrl !== undefined)
      userUpdates.avatarUrl = data.avatarUrl ?? null;
    if (data.cep !== undefined) userUpdates.cep = data.cep;
    if (data.address !== undefined) userUpdates.address = data.address;
    if (data.addressNumber !== undefined)
      userUpdates.addressNumber = data.addressNumber;
    if (data.addressComplement !== undefined)
      userUpdates.addressComplement = data.addressComplement;
    if (data.city !== undefined) userUpdates.city = data.city;
    if (data.state !== undefined) userUpdates.state = data.state;

    // Deletar avatar antigo do Storage quando for removido ou substituído
    if (data.avatarUrl !== undefined) {
      const oldAvatar = user.avatarUrl;
      if (
        oldAvatar &&
        !oldAvatar.startsWith('http') &&
        oldAvatar !== data.avatarUrl
      ) {
        try {
          await this.storageService.delete(oldAvatar);
        } catch {
          // não bloqueia a atualização se falhar
        }
      }
    }

    const updatedUser = await this.userRepository.update(userId, userUpdates);

    // Se tiver signatureUrl, atualizar DoctorProfile e deletar antiga do Storage
    if (data.signatureUrl !== undefined) {
      const docProfile =
        await this.doctorProfileRepository.findByUserId(userId);
      if (docProfile) {
        // Deletar assinatura antiga do Storage
        const oldSignature = docProfile.signatureUrl;
        if (
          oldSignature &&
          !oldSignature.startsWith('http') &&
          oldSignature !== data.signatureUrl
        ) {
          try {
            await this.storageService.delete(oldSignature);
          } catch {
            // não bloqueia a atualização se falhar
          }
        }
        await this.doctorProfileRepository.update(docProfile.id, {
          signatureUrl: data.signatureUrl,
        });
      }
    }

    return updatedUser;
  }

  async updateProfileById(
    targetId: string,
    data: UpdateProfileDto,
    requestingUserId: string,
  ) {
    const requesting = await this.userRepository.findOne({
      id: requestingUserId,
    });
    if (!requesting) throw new NotFoundException('Usuário não encontrado');

    const target = await this.userRepository.findOne({ id: targetId });
    if (!target) throw new NotFoundException('Usuário alvo não encontrado');

    // Apenas quem tem Administração ou o próprio usuário podem atualizar o
    // perfil. Editando terceiro: precisa estar no mesmo tenant (`ownerId`) —
    // sem essa checagem o alvo poderia estar em outra conta — e o alvo não
    // pode ser o dono da conta (essa rota grava `phone`/`cpf`/`name`; o
    // `phone` do dono é a chave de identidade dele no assistente WhatsApp
    // via `findOneByPhone`, então reescrevê-lo é sequestrar o canal dele).
    if (requestingUserId !== targetId) {
      await this.assertPodeGerirEquipe(requestingUserId);
      if (target.ownerId !== requesting.ownerId) {
        throw new ForbiddenException('Este usuário não pertence à sua conta');
      }
      this.assertAlvoNaoEhDono({ id: target.id, ownerId: target.ownerId });
    }

    if (data.phone) {
      const phoneFound = await this.userRepository.findOne({
        phone: data.phone,
        id: Not(targetId),
      });
      if (phoneFound) throw new BadRequestException('Telefone já está em uso');
    }

    if (data.cpf) {
      const cpfFound = await this.userRepository.findOne({
        cpf: data.cpf,
        id: Not(targetId),
      });
      if (cpfFound) throw new BadRequestException('CPF já está em uso');
    }

    const userUpdates: Partial<User> = {};
    if (data.name !== undefined) userUpdates.name = data.name;
    if (data.phone !== undefined) userUpdates.phone = data.phone;
    if (data.cpf !== undefined) userUpdates.cpf = data.cpf;
    if (data.birthDate !== undefined)
      userUpdates.birthDate = new Date(data.birthDate);
    // `gender` é `char(1)`, e o Postgres preenche `char` com espaço: gravar
    // string vazia devolve `' '` na leitura seguinte, que o DTO recusa
    // ("gender must be one of the following values: M, F, O, ''"). Resultado:
    // salvar duas vezes um usuário sem gênero definido falhava com 400. Vazio
    // é ausência de valor, então grava `null`.
    if (data.gender !== undefined)
      userUpdates.gender = data.gender?.trim() ? data.gender.trim() : null;
    if (data.avatarUrl !== undefined) userUpdates.avatarUrl = data.avatarUrl;
    if (data.cep !== undefined) userUpdates.cep = data.cep;
    if (data.address !== undefined) userUpdates.address = data.address;
    if (data.addressNumber !== undefined)
      userUpdates.addressNumber = data.addressNumber;
    if (data.addressComplement !== undefined)
      userUpdates.addressComplement = data.addressComplement;
    if (data.city !== undefined) userUpdates.city = data.city;
    if (data.state !== undefined) userUpdates.state = data.state;

    const updatedUser = await this.userRepository.update(targetId, userUpdates);
    return updatedUser;
  }

  async create(data: CreateUserDto, userId: string) {
    const user = await this.assertPodeGerirEquipe(userId);

    // Verifica telefone duplicado
    if (data.phone) {
      const phoneFound = await this.userRepository.findOne({
        phone: data.phone,
      });
      if (phoneFound) throw new BadRequestException('Telefone em uso');
    }

    // Verifica email duplicado
    const emailFound = await this.userRepository.findOne({ email: data.email });
    if (emailFound) throw new BadRequestException('Email em uso');

    const placeholderPw = generateValidationCode(16);

    // `data.role` é ignorado de propósito: esta rota é gateada por
    // Permission.ADMINISTRACAO (que o admin delegado também tem), e o novo
    // usuário herda `ownerId` de quem criou — nunca `self.id`. Se aceitássemos
    // `role: 'admin'` aqui, um delegado cunharia um segundo "dono" com
    // `ownerId` de outra pessoa, quebrando a invariante "para admin, ownerId
    // = self.id" usada em todo o isolamento de tenant. O DTO já restringe o
    // valor a `collaborator`; isto é a segunda camada.
    const newUser = await this.userRepository.create({
      email: data.email,
      name: data.name,
      phone: data.phone,
      role: UserRole.COLLABORATOR,
      status: UserStatus.PENDING,
      password: await bcrypt.hash(placeholderPw, BCRYPT_ROUNDS),
      ownerId: user.ownerId,
      adminId: userId,
    });

    // Gera token de convite (recovery code) válido por 72 horas
    await this.recoveryCodeRepository.deleteMany({
      userId: newUser.id,
      used: false,
    });
    const inviteToken = generateValidationCode(6);
    await this.recoveryCodeRepository.create({
      userId: newUser.id,
      used: false,
      code: inviteToken,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    });

    const dashboardUrl = this.configService.get<string>('DASHBOARD_URL');
    const setupLink = `${dashboardUrl}/primeiro-acesso?email=${encodeURIComponent(newUser.email)}&token=${inviteToken}`;

    void this.mailService.send(
      'invite-collaborator',
      newUser.email,
      'Você foi convidado para a Inexci!',
      {
        collaboratorName: newUser.name,
        inviterName: user.name,
        email: newUser.email,
        setupLink,
      },
    );

    if (newUser.phone) {
      void this.whatsappService.sendUserWelcome(newUser.phone, newUser.name);
    }

    return newUser;
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.userRepository.findOne({ id: userId }, true);
    if (!user) throw new NotFoundException('Usuário não encontrado');

    // Verifica senha atual
    if (!user.password) {
      throw new UnauthorizedException(
        'Conta sem senha definida. Acesse pelo link de primeiro acesso.',
      );
    }
    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isPasswordValid)
      throw new BadRequestException('Senha atual incorreta');

    // Atualiza senha
    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.userRepository.update(userId, { password: hashedPassword });

    return { message: 'Senha alterada com sucesso' };
  }

  async createDoctorProfile(dto: CreateDoctorProfileDto, userId: string) {
    const existing = await this.doctorProfileRepository.findByUserId(userId);
    if (existing)
      throw new BadRequestException(
        'Perfil de médico já existe para este usuário',
      );

    return this.doctorProfileRepository.create({
      userId: userId,
      specialty: dto.specialty,
      crm: dto.crm,
      crmState: dto.crmState,
      clinicName: dto.clinicName,
      clinicCnpj: dto.clinicCnpj,
      clinicAddress: dto.clinicAddress,
    });
  }

  // ============ PERFIL MÉDICO ============

  async updateDoctorProfileById(
    targetId: string,
    data: UpdateDoctorProfileDto,
    requestingUserId: string,
  ) {
    const requesting = await this.userRepository.findOneWithProfile({
      id: requestingUserId,
    });
    if (!requesting) throw new NotFoundException('Usuário não encontrado');

    const target = await this.userRepository.findOneWithProfile({
      id: targetId,
    });
    if (!target) throw new NotFoundException('Usuário alvo não encontrado');

    // Permitir acesso ao próprio usuário (se for médico) e a quem tem
    // Administração no MESMO tenant do alvo — pertencimento é `ownerId`
    // (o tenant), nunca `adminId` (só quem criou o registro). Checar por
    // `role === ADMIN` deixaria o admin delegado (role='collaborator' +
    // permissão) sem acesso a CRM/especialidade de qualquer médico que não
    // tenha criado — o mesmo bug do C3, aqui.
    const isSelf = requestingUserId === targetId;
    const permissoesRequesting = resolveEffectivePermissions({
      role: requesting.role,
      permissions: requesting.permissions,
      isDoctor: !!requesting.doctorProfile,
    });
    const isAdmin =
      permissoesRequesting.includes(Permission.ADMINISTRACAO) &&
      target.ownerId === requesting.ownerId;

    // Colaborador vinculado ao médico pode atualizar APENAS a assinatura.
    // CRM/estado/especialidade continuam restritos ao próprio médico ou admin.
    const onlySignature =
      data.crm === undefined &&
      data.crmState === undefined &&
      data.specialty === undefined;
    let isLinkedCollaborator = false;
    if (!isSelf && !isAdmin && onlySignature) {
      const accesses =
        await this.userDoctorAccessRepository.findActiveByUserId(
          requestingUserId,
        );
      isLinkedCollaborator = accesses.some((a) => a.doctorUserId === targetId);
    }

    if (!isSelf && !isAdmin && !isLinkedCollaborator) {
      throw new ForbiddenException(
        'Sem permissão para atualizar este perfil médico',
      );
    }

    if (!target.doctorProfile) {
      throw new BadRequestException('Este usuário não é médico');
    }

    // Atualiza no DoctorProfile
    const profileUpdates: Partial<DoctorProfile> = {};
    if (data.crm !== undefined) profileUpdates.crm = data.crm;
    if (data.crmState !== undefined) profileUpdates.crmState = data.crmState;
    if (data.specialty !== undefined) profileUpdates.specialty = data.specialty;
    if (data.signatureImageUrl !== undefined)
      profileUpdates.signatureUrl = data.signatureImageUrl ?? null;

    await this.doctorProfileRepository.update(
      target.doctorProfile.id,
      profileUpdates,
    );

    const updated = await this.userRepository.findOneWithProfile({
      id: targetId,
    });
    if (!updated) throw new NotFoundException('Usuário alvo não encontrado');

    // Quem chama esta rota pode ser um colaborador vinculado só-assinatura
    // (isLinkedCollaborator acima); permissions cru e isPlatformAdmin do
    // médico-alvo não devem vazar nessa resposta.
    const { permissions, isPlatformAdmin, ...updatedWithoutInternalFields } =
      updated;
    return updatedWithoutInternalFields;
  }

  // ============ GESTÃO DE COLABORADORES ============

  async findCollaborators(userId: string, skip = 0, take = 50) {
    const admin = await this.assertPodeGerirEquipe(userId);

    const collaborators = await this.userRepository.findByOwnerId(
      admin.ownerId,
      skip,
      take,
    );

    // O dono da conta não é "gerenciável" (`assertAlvoNaoEhDono` bloqueia
    // qualquer ação sobre ele) — não deve aparecer na lista de colaboradores
    // para ninguém, nem para si mesmo (já excluído por `c.id !== userId`)
    // nem para um admin delegado, que veria um botão de ação que sempre
    // falha com 403.
    const filtered = collaborators.filter(
      (c) => c.id !== userId && c.id !== admin.ownerId,
    );

    const records = await Promise.all(
      filtered.map(async (c) => {
        // `findByOwnerId` não define `select`, então devolve `permissions` e
        // `isPlatformAdmin` crus do TypeORM (vazamento pré-existente) — não
        // podem sair na resposta. `password` já não vem: a coluna tem
        // `select: false` na entidade.
        const { permissions, isPlatformAdmin, ...collaboratorFields } = c;

        return {
          ...collaboratorFields,
          avatarUrl: await this.resolveStorageUrl(c.avatarUrl),
          // A permissão EFETIVA, não a coluna crua — mesmo motivo do
          // getProfile/findCollaboratorById.
          permissions: resolveEffectivePermissions({
            role: c.role,
            permissions,
            isDoctor: !!c.doctorProfile,
          }),
        };
      }),
    );

    return { records };
  }

  async createCollaborator(data: CreateCollaboratorDto, adminId: string) {
    const admin = await this.assertPodeGerirEquipe(adminId);

    // Verifica email duplicado
    const emailFound = await this.userRepository.findOneWithDeleted({
      email: data.email,
    });
    if (emailFound) {
      if (!emailFound.deletedAt) {
        throw new BadRequestException('Email já está em uso');
      }
      // Usuário soft-deletado com email original (deletado antes da anonimização automática)
      // Anonimiza agora para liberar a constraint
      await this.userRepository.update(emailFound.id, {
        email: `deleted_${emailFound.email}_${emailFound.id}`,
      });
    }

    // Verifica telefone duplicado entre usuários ativos
    if (data.phone) {
      const phoneFound = await this.userRepository.findOne({
        phone: data.phone,
      });
      if (phoneFound) throw new BadRequestException('Telefone já está em uso');
    }

    const hasDoctorCredentials = Boolean(data.crm && data.crmState);
    const isDoctor = data.isDoctor ?? hasDoctorCredentials;

    // Gera uma senha aleatória apenas para satisfazer o schema — o colaborador
    // nunca saberá esta senha; ela será substituída ao definir a senha pelo link.
    const placeholderPassword = generateValidationCode(16);

    let newUser: Awaited<ReturnType<typeof this.userRepository.create>>;
    try {
      newUser = await this.userRepository.create({
        email: data.email,
        name: data.name,
        phone: data.phone,
        role: UserRole.COLLABORATOR,
        status: UserStatus.PENDING,
        password: await bcrypt.hash(placeholderPassword, BCRYPT_ROUNDS),
        ownerId: admin.ownerId,
        adminId: adminId,
        // Sem nada informado, o colaborador nasce sem acesso a área nenhuma
        // — `role` não vem deste DTO, só `permissions`.
        permissions: data.permissions ?? [],
      });
    } catch (err) {
      if (err instanceof QueryFailedError) {
        const msg = (err as any).detail ?? err.message;
        if (msg.includes('email')) {
          throw new BadRequestException('Email já está em uso');
        }
        if (msg.includes('phone')) {
          throw new BadRequestException('Telefone já está em uso');
        }
      }
      throw err;
    }

    // Se é médico, criar doctorProfile
    if (isDoctor && data.crm && data.crmState) {
      await this.doctorProfileRepository.create({
        userId: newUser.id,
        crm: data.crm,
        crmState: data.crmState,
        specialty: data.specialty || null,
      });
    }

    // Vínculo padrão: se o admin criador é médico (tem doctorProfile), o novo
    // colaborador já nasce com acesso às solicitações dele. Sem isso, o
    // colaborador não enxerga nenhum médico no modal de criação de SC até que
    // o admin faça a atribuição manual em user_doctor_access.
    const adminDoctorProfile = await this.doctorProfileRepository.findByUserId(
      admin.id,
    );
    if (adminDoctorProfile) {
      await this.userDoctorAccessRepository.upsert({
        userId: newUser.id,
        doctorUserId: admin.id,
        status: UserDoctorAccessStatus.ACTIVE,
        createdById: adminId,
      });
    }

    // Gera token de convite (recovery code) válido por 24 horas
    await this.recoveryCodeRepository.deleteMany({
      userId: newUser.id,
      used: false,
    });
    const inviteToken = randomUUID();
    await this.recoveryCodeRepository.create({
      userId: newUser.id,
      used: false,
      code: inviteToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 horas
    });

    const dashboardUrl = this.configService.get<string>('DASHBOARD_URL');
    const setupLink = `${dashboardUrl}/primeiro-acesso?email=${encodeURIComponent(newUser.email)}&token=${inviteToken}`;

    // Envia e-mail de convite usando template Handlebars
    void this.mailService.send(
      'invite-collaborator',
      newUser.email,
      'Você foi convidado para a Inexci!',
      {
        collaboratorName: newUser.name,
        inviterName: admin.name,
        email: newUser.email,
        setupLink,
      },
    );

    if (newUser.phone) {
      void this.whatsappService.sendUserWelcome(newUser.phone, newUser.name);
    }

    // `userRepository.create` devolve exatamente o que foi persistido — sem
    // `select` — então `newUser.permissions` ainda é a coluna crua e
    // `isPlatformAdmin` também está lá. Mesmo tratamento dos outros
    // retornos de colaborador: tira os dois e acrescenta a permissão
    // EFETIVA. `isDoctor` (calculado acima, antes do `doctorProfile` ser
    // criado) já reflete se o `doctor_profile` foi de fato criado — não
    // precisa recarregar do banco.
    const { permissions, isPlatformAdmin, ...newUserWithoutInternalFields } =
      newUser;

    return {
      ...newUserWithoutInternalFields,
      permissions: resolveEffectivePermissions({
        role: newUser.role,
        permissions,
        isDoctor,
      }),
    };
  }

  async updateCollaborator(
    collaboratorId: string,
    data: UpdateCollaboratorDto,
    adminId: string,
  ) {
    const admin = await this.assertPodeGerirEquipe(adminId);

    const collaborator = await this.userRepository.findOneWithProfile({
      id: collaboratorId,
    });
    if (!collaborator)
      throw new NotFoundException('Colaborador não encontrado');
    // Pertencimento é por `ownerId` (o tenant), não por `adminId` (só quem
    // criou): um admin delegado precisa editar colaboradores criados pelo
    // dono, e o dono precisa editar colaboradores criados pelo delegado.
    if (collaborator.ownerId !== admin.ownerId)
      throw new ForbiddenException('Este colaborador não pertence à sua conta');
    this.assertAlvoNaoEhDono({
      id: collaborator.id,
      ownerId: collaborator.ownerId,
    });

    // Verifica email duplicado
    if (data.email) {
      const emailFound = await this.userRepository.findOne({
        email: data.email,
        id: Not(collaboratorId),
      });
      if (emailFound) throw new BadRequestException('Email já está em uso');
    }

    // Verifica telefone duplicado
    if (data.phone) {
      const phoneFound = await this.userRepository.findOne({
        phone: data.phone,
        id: Not(collaboratorId),
      });
      if (phoneFound) throw new BadRequestException('Telefone já está em uso');
    }

    const hasProfile = !!collaborator.doctorProfile;

    // Campos do usuário base
    const updates: Partial<User> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.email !== undefined) updates.email = data.email;
    if (data.phone !== undefined) updates.phone = data.phone;
    if (data.cep !== undefined) updates.cep = data.cep;
    if (data.address !== undefined) updates.address = data.address;
    if (data.addressNumber !== undefined)
      updates.addressNumber = data.addressNumber;
    if (data.addressComplement !== undefined)
      updates.addressComplement = data.addressComplement;
    if (data.city !== undefined) updates.city = data.city;
    if (data.state !== undefined) updates.state = data.state;
    if (data.permissions !== undefined) {
      // `undefined` significa "não mexi nas permissões"; `[]` significa
      // "retirei todas". Os dois casos precisam ser distinguíveis — por
      // isso o `if` não usa o padrão `data.x ?? valorPadrao` dos campos
      // acima.
      updates.permissions = data.permissions;
    }

    // Gestão do doctorProfile
    if (data.isDoctor !== undefined) {
      if (data.isDoctor && !hasProfile) {
        // Criar doctorProfile
        await this.doctorProfileRepository.create({
          userId: collaboratorId,
          crm: data.crm || '',
          crmState: data.crmState || '',
          specialty: data.specialty || null,
        });
      } else if (!data.isDoctor && hasProfile) {
        // Remover doctorProfile
        await this.doctorProfileRepository.delete(
          collaborator.doctorProfile!.id,
        );
      } else if (data.isDoctor && hasProfile) {
        // Atualizar doctorProfile
        const profileUpdates: Partial<DoctorProfile> = {};
        if (data.crm !== undefined) profileUpdates.crm = data.crm;
        if (data.crmState !== undefined)
          profileUpdates.crmState = data.crmState;
        if (data.specialty !== undefined)
          profileUpdates.specialty = data.specialty;
        if (Object.keys(profileUpdates).length > 0) {
          await this.doctorProfileRepository.update(
            collaborator.doctorProfile!.id,
            profileUpdates,
          );
        }
      }
    } else {
      // Atualizar campos médicos no doctorProfile se existem
      if (
        hasProfile &&
        (data.crm !== undefined ||
          data.crmState !== undefined ||
          data.specialty !== undefined)
      ) {
        const profileUpdates: Partial<DoctorProfile> = {};
        if (data.crm !== undefined) profileUpdates.crm = data.crm;
        if (data.crmState !== undefined)
          profileUpdates.crmState = data.crmState;
        if (data.specialty !== undefined)
          profileUpdates.specialty = data.specialty;
        await this.doctorProfileRepository.update(
          collaborator.doctorProfile!.id,
          profileUpdates,
        );
      }
    }

    const updated = await this.userRepository.update(collaboratorId, updates);
    if (!updated) throw new NotFoundException('Colaborador não encontrado');

    // `userRepository.update` devolve o resultado de `findOne`, cujo
    // `select` não inclui `permissions` — por isso o admin que acabou de
    // conceder/revogar acesso não recebia confirmação nenhuma no payload.
    // Reconstrói o estado pós-mutação sem outra ida ao banco: `hasProfile`
    // (antes) + a mesma lógica de branches acima já dizem se o
    // `doctor_profile` existe agora, e a permissão gravada é `data.permissions`
    // quando informada, ou a que já estava em `collaborator` quando omitida.
    const isDoctorAfterUpdate =
      data.isDoctor !== undefined ? data.isDoctor : hasProfile;

    // O assistente do WhatsApp deriva `permissions` a partir de caches em
    // memória (identidade do usuário por telefone, ~10 min; médicos
    // acessíveis por userId, ~5 min — ver `AiOrchestratorService`), não a
    // cada mensagem como o guard HTTP faz a cada request. Sem este evento,
    // revogar `SOLICITACOES` (ou o `doctor_profile`) de um colaborador
    // deixaria uma janela de até 10 min em que o WhatsApp ainda opera com a
    // permissão antiga. Emitido só quando o que afeta a permissão efetiva
    // (`data.permissions` ou `data.isDoctor`) de fato mudou.
    if (data.permissions !== undefined || data.isDoctor !== undefined) {
      this.emitAccessChanged(collaboratorId, collaborator.phone);
    }

    const grantedPermissionsAfterUpdate =
      data.permissions !== undefined
        ? data.permissions
        : (collaborator.permissions ?? []);

    return {
      ...updated,
      // Efetiva — para exibir. Ver `findCollaboratorById` para o motivo de
      // nunca usar este campo para semear um formulário de edição.
      permissions: resolveEffectivePermissions({
        role: collaborator.role,
        permissions: grantedPermissionsAfterUpdate,
        isDoctor: isDoctorAfterUpdate,
      }),
      // Crua — para editar (o que a tela deve guardar como novo baseline).
      grantedPermissions: grantedPermissionsAfterUpdate,
    };
  }

  async deleteCollaborator(collaboratorId: string, adminId: string) {
    const admin = await this.assertPodeGerirEquipe(adminId);

    const collaborator = await this.userRepository.findOne({
      id: collaboratorId,
    });
    if (!collaborator)
      throw new NotFoundException('Colaborador não encontrado');
    // Pertencimento é por `ownerId` (o tenant), não por `adminId` (só quem
    // criou) — ver mesmo comentário em `updateCollaborator`.
    if (collaborator.ownerId !== admin.ownerId)
      throw new ForbiddenException('Este colaborador não pertence à sua conta');
    this.assertAlvoNaoEhDono({
      id: collaborator.id,
      ownerId: collaborator.ownerId,
    });

    // Telefone ORIGINAL, capturado antes da sentinela sobrescrever a coluna
    // — é essa a chave que `MessageProcessorService.userCache` usa. Emitir a
    // invalidação com o telefone já trocado (`DEL...`) limparia uma entrada
    // de cache que nunca existiu e deixaria a antiga intacta.
    const originalPhone = collaborator.phone;

    // Anonimiza dados pessoais antes do soft-delete (LGPD — princípio de minimização).
    // email: libera a constraint unique para permitir re-cadastro com mesmo endereço.
    // phone: quebra o match no findOneByPhone, impedindo que um ex-colaborador continue
    //        sendo identificado pelo sistema (incluindo o assistente WhatsApp). A sentinela
    //        usa os 12 primeiros chars do UUID para unicidade sem ultrapassar varchar(15).
    await this.userRepository.update(collaboratorId, {
      email: `deleted_${collaborator.email}_${collaboratorId}`,
      phone: `DEL${collaboratorId.slice(0, 12)}`,
    });
    await this.userRepository.delete(collaboratorId);

    // A troca de telefone acima já impede um NOVO lookup por telefone de
    // encontrar este usuário — mas não apaga a entrada já cacheada em
    // `MessageProcessorService.userCache` (até 10 min) nem o
    // `accessibleDoctorIds` cacheado por userId (até 5 min) em
    // `AiOrchestratorService`. Sem isto, um colaborador excluído continuaria
    // operando pelo WhatsApp com a identidade e permissões antigas — inclusive
    // mutando SC — pela duração desses caches.
    this.emitAccessChanged(collaboratorId, originalPhone);

    return { message: 'Colaborador desativado com sucesso' };
  }

  async bulkDeleteCollaborators(
    collaboratorIds: string[],
    adminId: string,
  ): Promise<{ deleted: number }> {
    const admin = await this.assertPodeGerirEquipe(adminId);

    const uniqueIds = [...new Set(collaboratorIds)];
    // Pertencimento é por `ownerId` (o tenant), não por `adminId` (só quem
    // criou) — do contrário colaboradores criados por outra pessoa dentro da
    // mesma conta (o dono, ou outro admin delegado) ficariam invisíveis a
    // este filtro e o bulk delete falharia com "não encontrados" para eles.
    const collaborators = await this.userRepository.getRepository().find({
      where: {
        id: In(uniqueIds),
        ownerId: admin.ownerId,
        role: UserRole.COLLABORATOR,
      },
      select: {
        id: true,
        email: true,
        ownerId: true,
        // Telefone ORIGINAL — precisa ser capturado antes da sentinela
        // sobrescrever a coluna, senão a invalidação de cache (ver loop
        // abaixo) usaria o telefone errado e não limparia nada.
        phone: true,
      },
    });

    if (collaborators.length !== uniqueIds.length) {
      throw new NotFoundException(
        'Um ou mais colaboradores não foram encontrados.',
      );
    }

    // O alvo é cada item da lista, não a lista — o dono da conta jamais pode
    // ser incluído em um bulk delete de colaboradores.
    for (const collaborator of collaborators) {
      this.assertAlvoNaoEhDono({
        id: collaborator.id,
        ownerId: collaborator.ownerId,
      });
    }

    for (const collaborator of collaborators) {
      await this.userRepository.update(collaborator.id, {
        email: `deleted_${collaborator.email ?? 'sem-email'}_${collaborator.id}`,
        phone: `DEL${collaborator.id.slice(0, 12)}`,
      });
    }

    await this.userRepository.getRepository().softDelete(uniqueIds);

    // Mesmo raciocínio de `deleteCollaborator`: sem isto, cada colaborador
    // excluído em lote continuaria com identidade/permissões cacheadas no
    // assistente do WhatsApp por até 10 min.
    for (const collaborator of collaborators) {
      this.emitAccessChanged(collaborator.id, collaborator.phone);
    }

    return { deleted: uniqueIds.length };
  }

  // ============ MÉDICOS DA CONTA ============

  /**
   * Lista médicos da conta (users com doctorProfile na mesma conta)
   */
  async findDoctors(userId: string) {
    const admin = await this.assertPodeGerirEquipe(userId);

    const doctors = await this.userRepository.findDoctorsByOwnerId(
      admin.ownerId,
    );

    const records = await Promise.all(
      doctors.map(async (d) => {
        const { password, ...rest } = d;
        return {
          ...rest,
          avatarUrl: await this.resolveStorageUrl(d.avatarUrl),
        };
      }),
    );

    return { records };
  }

  async toggleCollaboratorStatus(collaboratorId: string, adminId: string) {
    const admin = await this.assertPodeGerirEquipe(adminId);

    const collaborator = await this.userRepository.findOne({
      id: collaboratorId,
    });
    if (!collaborator)
      throw new NotFoundException('Colaborador não encontrado');
    // Pertencimento é por `ownerId` (o tenant), não por `adminId` (só quem
    // criou) — ver mesmo comentário em `updateCollaborator`.
    if (collaborator.ownerId !== admin.ownerId)
      throw new ForbiddenException('Este colaborador não pertence à sua conta');
    this.assertAlvoNaoEhDono({
      id: collaborator.id,
      ownerId: collaborator.ownerId,
    });

    const newStatus =
      collaborator.status === UserStatus.ACTIVE
        ? UserStatus.INACTIVE
        : UserStatus.ACTIVE;

    await this.userRepository.update(collaboratorId, { status: newStatus });

    // Invalida os caches do assistente do WhatsApp assim que o status muda
    // (em qualquer direção). `MessageProcessorService.runPreflight` agora
    // espelha a `JwtStrategy` do caminho web e recusa `status !== ACTIVE` —
    // e nunca cacheia usuário não-ACTIVE — então a invalidação aqui garante
    // que a próxima mensagem já vê o banco atualizado em vez de servir do
    // cache por até 10 min.
    this.emitAccessChanged(collaboratorId, collaborator.phone);

    return { status: newStatus };
  }

  async resetCollaboratorPassword(
    collaboratorId: string,
    newPassword: string,
    adminId: string,
  ) {
    const admin = await this.assertPodeGerirEquipe(adminId);

    const collaborator = await this.userRepository.findOne({
      id: collaboratorId,
    });
    if (!collaborator)
      throw new NotFoundException('Colaborador não encontrado');
    // Pertencimento é por `ownerId` (o tenant), não por `adminId` (só quem
    // criou) — ver mesmo comentário em `updateCollaborator`.
    if (collaborator.ownerId !== admin.ownerId)
      throw new ForbiddenException('Este colaborador não pertence à sua conta');
    this.assertAlvoNaoEhDono({
      id: collaborator.id,
      ownerId: collaborator.ownerId,
    });

    const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.userRepository.update(collaboratorId, { password: hashed });

    // Mesma logica de `AuthService.changePassword`: redefinir a senha por
    // admin tambem precisa encerrar as sessoes existentes do colaborador.
    await this.refreshTokenStore.revokeAllForUser(collaborator.id);

    return { message: 'Senha redefinida com sucesso' };
  }

  /**
   * Reenvia o e-mail de convite (link de primeiro acesso) para um colaborador
   * que ainda não ativou a conta. Gera um novo token de 72h e invalida os
   * anteriores. Disponível apenas para colaboradores com status PENDING.
   */
  async resendCollaboratorInvite(collaboratorId: string, adminId: string) {
    const admin = await this.assertPodeGerirEquipe(adminId);

    const collaborator = await this.userRepository.findOne({
      id: collaboratorId,
    });
    if (!collaborator) {
      throw new NotFoundException('Colaborador não encontrado');
    }
    if (collaborator.ownerId !== admin.ownerId) {
      throw new ForbiddenException('Este colaborador não pertence à sua conta');
    }
    this.assertAlvoNaoEhDono({
      id: collaborator.id,
      ownerId: collaborator.ownerId,
    });
    if (collaborator.status !== UserStatus.PENDING) {
      throw new BadRequestException(
        'Este usuário já ativou a conta. Reenvio de convite só está disponível para convites pendentes.',
      );
    }
    if (!collaborator.email) {
      throw new BadRequestException('Colaborador não possui e-mail cadastrado');
    }

    // Invalida TODOS os tokens anteriores deste usuário (usados ou não) para
    // garantir que apenas o novo link seja válido. Sem o filtro de `used`,
    // tokens já validados (mas com senha ainda não trocada) também são
    // descartados — caso contrário o link antigo continuaria funcionando.
    await this.recoveryCodeRepository.deleteMany({
      userId: collaborator.id,
    });

    const inviteToken = generateValidationCode(6);
    await this.recoveryCodeRepository.create({
      userId: collaborator.id,
      used: false,
      code: inviteToken,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    });

    const dashboardUrl = this.configService.get<string>('DASHBOARD_URL');
    const setupLink = `${dashboardUrl}/primeiro-acesso?email=${encodeURIComponent(collaborator.email)}&token=${inviteToken}`;

    void this.mailService.send(
      'invite-collaborator',
      collaborator.email,
      'Você foi convidado para a Inexci!',
      {
        collaboratorName: collaborator.name,
        inviterName: admin.name,
        email: collaborator.email,
        setupLink,
      },
    );

    return {
      message: 'Convite reenviado com sucesso',
      email: collaborator.email,
    };
  }

  /**
   * Detalhes de um colaborador (dados + doctorProfile + user_doctor_access)
   */
  async findCollaboratorById(collaboratorId: string, adminId: string) {
    const admin = await this.assertPodeGerirEquipe(adminId);

    const collaborator = await this.userRepository.findOneWithProfile({
      id: collaboratorId,
    });
    if (!collaborator)
      throw new NotFoundException('Colaborador não encontrado');
    if (collaborator.ownerId !== admin.ownerId)
      throw new ForbiddenException('Este colaborador não pertence à sua conta');

    // Buscar vínculos com médicos
    const accesses =
      await this.userDoctorAccessRepository.findAllByUserId(collaboratorId);

    // Remove senha e campo interno (isPlatformAdmin) do retorno. `permissions`
    // crua é retirada do spread e devolvida à parte como `grantedPermissions`
    // (ver abaixo) — só esta rota pode expor a coluna crua, porque é a única
    // gated por `ADMINISTRACAO` que a tela de edição de colaborador consome.
    const { password, permissions, isPlatformAdmin, ...userWithoutPassword } =
      collaborator;

    const [avatarUrl, signatureUrl] = await Promise.all([
      this.resolveStorageUrl(userWithoutPassword.avatarUrl),
      this.resolveStorageUrl(collaborator.doctorProfile?.signatureUrl),
    ]);

    return {
      ...userWithoutPassword,
      avatarUrl,
      doctorProfile: userWithoutPassword.doctorProfile
        ? { ...userWithoutPassword.doctorProfile, signatureUrl }
        : userWithoutPassword.doctorProfile,
      isDoctor: !!collaborator.doctorProfile,
      doctorAccesses: accesses,
      // A permissão EFETIVA (com o bônus de médico já somado) — para EXIBIR
      // o que o colaborador pode fazer hoje. Nunca usar este campo para
      // semear um formulário de edição: ele reintroduziria no PATCH, como
      // concessão gravada, o que só valia por causa de `doctor_profile`
      // (bug I2 do PLANO-PERMISSOES-COLABORADORES — desmarcar "é médico"
      // meses depois não voltava a tirar Agenda/Atendimento/Solicitações,
      // porque a tela nunca soube que elas não tinham sido concedidas de
      // fato).
      permissions: resolveEffectivePermissions({
        role: collaborator.role,
        permissions,
        isDoctor: !!collaborator.doctorProfile,
      }),
      // A coluna CRUA (o que foi de fato concedido) — para EDITAR. É este
      // campo que a tela de colaborador deve semear no formulário e
      // devolver no PATCH, nunca `permissions`.
      grantedPermissions: permissions ?? [],
    };
  }

  // ============ CABEÇALHO DE DOCUMENTOS ============

  private sanitizeHeaderHtml(html: string): string {
    return sanitizeHtml(html, {
      allowedTags: [
        'p',
        'br',
        'strong',
        'em',
        'u',
        'ul',
        'ol',
        'li',
        'h1',
        'h2',
        'h3',
        'h4',
        'span',
      ],
      allowedAttributes: {
        '*': ['style'],
      },
      allowedStyles: {
        '*': {
          'text-align': [/^(left|right|center|justify)$/],
          'font-weight': [/^(normal|bold|[1-9]00)$/],
          color: [/^#[0-9a-fA-F]{3,6}$/, /^rgb\(\d+,\s*\d+,\s*\d+\)$/],
        },
      },
    });
  }

  private async getAuthorizedDoctorProfileForHeader(
    targetUserId: string,
    requestingUserId: string,
  ) {
    const requesting = await this.userRepository.findOneWithProfile({
      id: requestingUserId,
    });
    if (!requesting) throw new NotFoundException('Usuário não encontrado');

    const target = await this.userRepository.findOne({ id: targetUserId });
    if (!target) throw new NotFoundException('Usuário alvo não encontrado');

    const isSelf = requestingUserId === targetUserId;
    // Rota já é gateada por ADMINISTRACAO no controller (RequirePermission);
    // aqui restringimos ao mesmo tenant. Pertencimento é `ownerId`, nunca
    // `adminId` (só quem criou) — checar por `target.adminId ===
    // requestingUserId` é o mesmo bug do C3: barra o admin delegado no
    // cabeçalho de qualquer médico que não tenha criado (a maioria) e barra
    // o dono no cabeçalho de médico criado pelo delegado.
    const permissoesRequesting = resolveEffectivePermissions({
      role: requesting.role,
      permissions: requesting.permissions,
      isDoctor: !!requesting.doctorProfile,
    });
    const isAccountAdmin =
      permissoesRequesting.includes(Permission.ADMINISTRACAO) &&
      target.ownerId === requesting.ownerId;

    if (!isSelf && !isAccountAdmin) {
      throw new ForbiddenException(
        'Sem permissão para configurar este cabeçalho',
      );
    }

    const profile =
      await this.doctorProfileRepository.findByUserId(targetUserId);
    if (!profile)
      throw new ForbiddenException(
        'Este usuário não possui perfil de médico para cabeçalho',
      );

    return profile;
  }

  async getMyHeader(userId: string) {
    const profile = await this.doctorProfileRepository.findByUserId(userId);
    if (!profile) return null;
    return this.doctorHeaderRepository.findByDoctorProfileId(profile.id);
  }

  async upsertMyHeader(userId: string, dto: UpsertDoctorHeaderDto) {
    const profile = await this.doctorProfileRepository.findByUserId(userId);
    if (!profile)
      throw new ForbiddenException('Apenas médicos podem configurar cabeçalho');

    const data: Parameters<DoctorHeaderRepository['upsert']>[1] = {
      logoPosition: dto.logoPosition ?? 'left',
    };

    if (dto.logoUrl !== undefined) {
      data.logoUrl = dto.logoUrl;
    }

    if (dto.contentHtml !== undefined) {
      data.contentHtml = dto.contentHtml
        ? this.sanitizeHeaderHtml(dto.contentHtml)
        : null;
    }

    return this.doctorHeaderRepository.upsert(profile.id, data);
  }

  async deleteMyHeader(userId: string) {
    const profile = await this.doctorProfileRepository.findByUserId(userId);
    if (!profile)
      throw new ForbiddenException('Apenas médicos podem remover cabeçalho');
    await this.doctorHeaderRepository.removeByDoctorProfileId(profile.id);
    return { message: 'Cabeçalho removido com sucesso' };
  }

  async getDoctorHeaderByUserId(
    targetUserId: string,
    requestingUserId: string,
  ) {
    const profile = await this.getAuthorizedDoctorProfileForHeader(
      targetUserId,
      requestingUserId,
    );
    return this.doctorHeaderRepository.findByDoctorProfileId(profile.id);
  }

  async upsertDoctorHeaderByUserId(
    targetUserId: string,
    dto: UpsertDoctorHeaderDto,
    requestingUserId: string,
  ) {
    const profile = await this.getAuthorizedDoctorProfileForHeader(
      targetUserId,
      requestingUserId,
    );

    const data: Parameters<DoctorHeaderRepository['upsert']>[1] = {
      logoPosition: dto.logoPosition ?? 'left',
    };

    if (dto.logoUrl !== undefined) {
      data.logoUrl = dto.logoUrl;
    }

    if (dto.contentHtml !== undefined) {
      data.contentHtml = dto.contentHtml
        ? this.sanitizeHeaderHtml(dto.contentHtml)
        : null;
    }

    return this.doctorHeaderRepository.upsert(profile.id, data);
  }

  async deleteDoctorHeaderByUserId(
    targetUserId: string,
    requestingUserId: string,
  ) {
    const profile = await this.getAuthorizedDoctorProfileForHeader(
      targetUserId,
      requestingUserId,
    );
    await this.doctorHeaderRepository.removeByDoctorProfileId(profile.id);
    return { message: 'Cabeçalho removido com sucesso' };
  }

  // ============ ASSINATURA DIGITAL ============

  async updateSignatureUrl(userId: string, signatureUrl: string) {
    const profile = await this.doctorProfileRepository.findByUserId(userId);
    if (!profile)
      throw new ForbiddenException(
        'Apenas médicos podem atualizar a assinatura digital.',
      );
    await this.doctorProfileRepository.update(profile.id, { signatureUrl });
  }

  private async resolveStorageUrl(
    path?: string | null,
  ): Promise<string | null> {
    if (!path) return null;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    try {
      return await this.storageService.getSignedUrl(path);
    } catch {
      return null;
    }
  }
}
