import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import * as sanitizeHtml from 'sanitize-html';
import { Not, QueryFailedError } from 'typeorm';
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
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateCollaboratorDto } from './dto/create-collaborator.dto';
import { UpdateCollaboratorDto } from './dto/update-collaborator.dto';
import { UpdateDoctorProfileDto } from './dto/update-doctor-profile.dto';
import { UpsertDoctorHeaderDto } from './dto/upsert-doctor-header.dto';

import { UserRepository } from 'src/database/repositories/user.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { DoctorHeaderRepository } from 'src/database/repositories/doctor-header.repository';
import {
  Permission,
  canAdministrate,
  permissionsOf,
  resolveEffectivePermissions,
} from 'src/shared/permissions';
import { MailService } from 'src/shared/mail/mail.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { BCRYPT_ROUNDS } from 'src/shared/constants/bcrypt';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { User, UserRole, UserStatus } from 'src/database/entities/user.entity';
import {
  DoctorProfile,
  isPhysicianProfile,
  ProfessionalCouncil,
} from 'src/database/entities/doctor-profile.entity';
import { UserDoctorAccessRepository } from 'src/database/repositories/user-doctor-access.repository';
import { UserDoctorAccessStatus } from 'src/database/entities/user-doctor-access.entity';
import { RecoveryCodeRepository } from 'src/database/repositories/recovery-code.repository';
import { RefreshTokenStore } from '../auth/refresh-token.store';

import { generateValidationCode, omitUserSecrets } from 'src/shared/utils';
import {
  ehArquivoDaConta,
  PASTAS_DE_ASSINATURA,
  PASTAS_DE_AVATAR,
} from './arquivo-da-conta';
import { errorMessage } from 'src/shared/utils/error-message.util';

export const AVATAR_INVALIDO = 'Avatar inválido: envie a imagem novamente.';
export const ASSINATURA_INVALIDA =
  'Assinatura inválida: envie a imagem novamente.';

const MS_PER_HOUR = 60 * 60 * 1000;
const INVITE_TOKEN_TTL_MS = 24 * MS_PER_HOUR;
const INVITE_CODE_TTL_MS = 72 * MS_PER_HOUR;

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
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  private emitAccessChanged(userId: string, phone: string | null | undefined) {
    this.eventEmitter?.emit('user.access_changed', { userId, phone });
  }

  private async assertPodeGerirEquipe(userId: string): Promise<User> {
    const usuario = await this.userRepository.findOneWithProfile({
      id: userId,
    });
    if (!usuario) throw new NotFoundException('Usuário não encontrado');

    const permissoes = permissionsOf(usuario);

    if (!permissoes.includes(Permission.ADMINISTRACAO)) {
      throw new ForbiddenException(
        'Você não tem permissão para gerenciar colaboradores.',
      );
    }

    return usuario;
  }

  private assertAlvoNaoEhDono(alvo: { id: string; ownerId: string }): void {
    if (alvo.id === alvo.ownerId) {
      throw new ForbiddenException(
        'O dono da conta não pode ser alterado por outro usuário.',
      );
    }
  }

  async getProfile(userId: string) {
    const user = await this.userRepository.findOneWithProfile({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const { permissions, isPlatformAdmin, onboardingState, ...comCredenciais } =
      user;
    const userWithoutPassword = omitUserSecrets(comCredenciais);

    const profile = userWithoutPassword.doctorProfile;
    if (profile?.signatureUrl && !profile.signatureUrl.startsWith('http')) {
      try {
        profile.signatureUrl = await this.storageService.getSignedUrl(
          profile.signatureUrl,
        );
      } catch (err: unknown) {
        this.logger.warn(
          `Falha ao assinar a URL da assinatura do perfil ${userId}: ${errorMessage(err)}`,
        );
      }
    }

    return {
      ...userWithoutPassword,
      isDoctor: !!userWithoutPassword.doctorProfile,
      isPhysician: isPhysicianProfile(userWithoutPassword.doctorProfile),
      permissions: permissionsOf({
        role: userWithoutPassword.role,
        permissions,
        doctorProfile: userWithoutPassword.doctorProfile,
      }),
    };
  }

  async updateProfile(data: UpdateProfileDto, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    if (data.phone) {
      const phoneFound = await this.userRepository.findOne({
        phone: data.phone,
        id: Not(userId),
      });
      if (phoneFound) throw new BadRequestException('Telefone já está em uso');
    }

    if (data.cpf) {
      const cpfFound = await this.userRepository.findOne({
        cpf: data.cpf,
        id: Not(userId),
      });
      if (cpfFound) throw new BadRequestException('CPF já está em uso');
    }

    const novoAvatar =
      data.avatarUrl !== undefined
        ? this.validarCaminhoDeArquivo(
            data.avatarUrl,
            user.avatarUrl,
            PASTAS_DE_AVATAR,
            user.ownerId,
            AVATAR_INVALIDO,
          )
        : undefined;
    const docProfile =
      data.signatureUrl !== undefined
        ? await this.doctorProfileRepository.findByUserId(userId)
        : null;
    const novaAssinatura =
      docProfile && data.signatureUrl !== undefined
        ? this.validarCaminhoDeArquivo(
            data.signatureUrl,
            docProfile.signatureUrl,
            PASTAS_DE_ASSINATURA,
            user.ownerId,
            ASSINATURA_INVALIDA,
          )
        : undefined;

    const userUpdates: Partial<User> = {};
    if (data.name) userUpdates.name = data.name;
    if (data.phone) userUpdates.phone = data.phone;
    if (data.cpf) userUpdates.cpf = data.cpf;
    if (data.birthDate) userUpdates.birthDate = new Date(data.birthDate);
    if (data.gender) userUpdates.gender = data.gender;
    if (novoAvatar !== undefined) userUpdates.avatarUrl = novoAvatar;
    if (data.cep !== undefined) userUpdates.cep = data.cep;
    if (data.address !== undefined) userUpdates.address = data.address;
    if (data.addressNumber !== undefined)
      userUpdates.addressNumber = data.addressNumber;
    if (data.addressComplement !== undefined)
      userUpdates.addressComplement = data.addressComplement;
    if (data.city !== undefined) userUpdates.city = data.city;
    if (data.state !== undefined) userUpdates.state = data.state;

    await this.userRepository.update(userId, userUpdates);

    if (novoAvatar !== undefined && user.avatarUrl !== novoAvatar) {
      const antigo = user.avatarUrl;
      if (
        ehArquivoDaConta(antigo, PASTAS_DE_AVATAR, user.ownerId) &&
        !(await this.userRepository.findOne({
          avatarUrl: antigo!,
          id: Not(userId),
        }))
      ) {
        await this.apagarDoStorage(antigo!);
      }
    }

    if (docProfile && novaAssinatura !== undefined) {
      await this.doctorProfileRepository.update(docProfile.id, {
        signatureUrl: novaAssinatura,
      });
      const antiga = docProfile.signatureUrl;
      if (
        antiga !== novaAssinatura &&
        ehArquivoDaConta(antiga, PASTAS_DE_ASSINATURA, user.ownerId) &&
        !(await this.doctorProfileRepository.findOne({
          signatureUrl: antiga!,
          id: Not(docProfile.id),
        }))
      ) {
        await this.apagarDoStorage(antiga!);
      }
    }

    return this.getProfile(userId);
  }

  private validarCaminhoDeArquivo(
    valor: string | null | undefined,
    atual: string | null | undefined,
    pastas: readonly string[],
    ownerId: string,
    mensagem: string,
  ): string | null {
    const caminho = valor?.trim() || null;
    if (!caminho) return null;
    if (caminho === atual) return caminho;
    if (!ehArquivoDaConta(caminho, pastas, ownerId)) {
      throw new BadRequestException(mensagem);
    }
    return caminho;
  }

  private async apagarDoStorage(caminho: string): Promise<void> {
    try {
      await this.storageService.delete(caminho);
    } catch {
      this.logger.warn('Falha ao apagar arquivo antigo do perfil do storage');
    }
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
    if (data.gender !== undefined)
      userUpdates.gender = data.gender?.trim() ? data.gender.trim() : null;
    if (data.avatarUrl !== undefined)
      userUpdates.avatarUrl = this.validarCaminhoDeArquivo(
        data.avatarUrl,
        target.avatarUrl,
        PASTAS_DE_AVATAR,
        target.ownerId,
        AVATAR_INVALIDO,
      );
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

    if (data.phone) {
      const phoneFound = await this.userRepository.findOne({
        phone: data.phone,
      });
      if (phoneFound) throw new BadRequestException('Telefone em uso');
    }

    const emailFound = await this.userRepository.findOne({ email: data.email });
    if (emailFound) throw new BadRequestException('Email em uso');

    const placeholderPw = generateValidationCode(16);

    const newUser = await this.userRepository.create({
      email: data.email,
      name: data.name,
      phone: data.phone,
      role: UserRole.COLLABORATOR,
      status: UserStatus.PENDING,
      password: await bcrypt.hash(placeholderPw, BCRYPT_ROUNDS),
      ownerId: user.ownerId,
    });

    await this.recoveryCodeRepository.deleteMany({
      userId: newUser.id,
      used: false,
    });
    const inviteToken = generateValidationCode(6);
    await this.recoveryCodeRepository.create({
      userId: newUser.id,
      used: false,
      code: inviteToken,
      expiresAt: new Date(Date.now() + INVITE_CODE_TTL_MS),
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

    return omitUserSecrets(newUser);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.userRepository.findOne({ id: userId }, true);
    if (!user) throw new NotFoundException('Usuário não encontrado');

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

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.userRepository.update(userId, { password: hashedPassword });

    return { message: 'Senha alterada com sucesso' };
  }

  async updateDoctorProfileById(
    targetId: string,
    data: UpdateDoctorProfileDto,
    requestingUserId: string,
  ) {
    const [requesting, target] = await Promise.all([
      this.userRepository.findOneWithProfile({ id: requestingUserId }),
      this.userRepository.findOneWithProfile({ id: targetId }),
    ]);
    if (!requesting) throw new NotFoundException('Usuário não encontrado');
    if (!target) throw new NotFoundException('Usuário alvo não encontrado');

    const { isSelf, isAdmin } = await this.assertPodeEditarPerfilMedico(
      requesting,
      target,
      data,
    );

    const doctorProfile = target.doctorProfile;
    if (!doctorProfile) {
      throw new BadRequestException('Este usuário não é médico');
    }

    const mudaConselho =
      data.council !== undefined && data.council !== doctorProfile.council;
    const ehDonoDaConta = target.id === target.ownerId;
    if (mudaConselho && (!isAdmin || (isSelf && !ehDonoDaConta))) {
      throw new ForbiddenException(
        'Somente a administração da conta altera o conselho profissional.',
      );
    }

    await this.doctorProfileRepository.update(
      doctorProfile.id,
      this.montarAtualizacaoDoPerfilMedico(data, target, doctorProfile),
    );
    if (mudaConselho) {
      this.emitAccessChanged(targetId, target.phone);
    }

    const updated = await this.userRepository.findOneWithProfile({
      id: targetId,
    });
    if (!updated) throw new NotFoundException('Usuário alvo não encontrado');

    const {
      permissions,
      isPlatformAdmin,
      onboardingState,
      ...updatedWithoutInternalFields
    } = updated;
    return updatedWithoutInternalFields;
  }

  private async assertPodeEditarPerfilMedico(
    requesting: User,
    target: User,
    data: UpdateDoctorProfileDto,
  ): Promise<{ isSelf: boolean; isAdmin: boolean }> {
    const isSelf = requesting.id === target.id;
    const isAdmin =
      canAdministrate(requesting) && target.ownerId === requesting.ownerId;

    const onlySignature =
      data.council === undefined &&
      data.crm === undefined &&
      data.crmState === undefined &&
      data.specialty === undefined;
    const alvoEhDono = target.id === target.ownerId;
    let isLinkedCollaborator = false;
    if (!isSelf && onlySignature && (!isAdmin || alvoEhDono)) {
      const accesses = await this.userDoctorAccessRepository.findActiveByUserId(
        requesting.id,
      );
      isLinkedCollaborator = accesses.some((a) => a.doctorUserId === target.id);
    }

    if (!isSelf && !isAdmin && !isLinkedCollaborator) {
      throw new ForbiddenException(
        'Sem permissão para atualizar este perfil médico',
      );
    }

    if (!isSelf && !(onlySignature && isLinkedCollaborator)) {
      this.assertAlvoNaoEhDono({ id: target.id, ownerId: target.ownerId });
    }

    return { isSelf, isAdmin };
  }

  private montarAtualizacaoDoPerfilMedico(
    data: UpdateDoctorProfileDto,
    target: User,
    atual: DoctorProfile,
  ): Partial<DoctorProfile> {
    const profileUpdates: Partial<DoctorProfile> = {};
    if (data.council !== undefined) profileUpdates.council = data.council;
    if (data.crm !== undefined) profileUpdates.crm = data.crm?.trim() || null;
    if (data.crmState !== undefined)
      profileUpdates.crmState = data.crmState?.trim() || null;
    if (data.specialty !== undefined) profileUpdates.specialty = data.specialty;

    if (
      data.council !== undefined ||
      data.crm !== undefined ||
      data.crmState !== undefined
    )
      UsersService.assertRegistroDoConselho(
        profileUpdates.council ?? atual.council,
        'crm' in profileUpdates ? profileUpdates.crm : atual.crm,
        'crmState' in profileUpdates ? profileUpdates.crmState : atual.crmState,
      );
    if (data.signatureImageUrl !== undefined)
      profileUpdates.signatureUrl = this.validarCaminhoDeArquivo(
        data.signatureImageUrl,
        atual.signatureUrl,
        PASTAS_DE_ASSINATURA,
        target.ownerId,
        ASSINATURA_INVALIDA,
      );
    return profileUpdates;
  }

  async findCollaborators(userId: string, skip = 0, take = 50) {
    const admin = await this.assertPodeGerirEquipe(userId);

    const collaborators = await this.userRepository.findByOwnerId(
      admin.ownerId,
      skip,
      take,
    );

    const filtered = collaborators.filter(
      (c) => c.id !== userId && c.id !== admin.ownerId,
    );

    const records = await Promise.all(
      filtered.map(async (c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        role: c.role,
        status: c.status,
        ownerId: c.ownerId,
        emailVerified: c.emailVerified,
        doctorProfile: c.doctorProfile ?? null,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        avatarUrl: await this.resolveStorageUrl(c.avatarUrl),
        permissions: permissionsOf(c),
      })),
    );

    return { records };
  }

  async createCollaborator(data: CreateCollaboratorDto, adminId: string) {
    const admin = await this.assertPodeGerirEquipe(adminId);
    await this.liberarContatoParaConvite(data);

    const council = data.council ?? ProfessionalCouncil.CRM;
    const hasDoctorCredentials = Boolean(data.crm && data.crmState);
    const isDoctor = data.isDoctor ?? hasDoctorCredentials;
    if (isDoctor) {
      UsersService.assertRegistroDoConselho(council, data.crm, data.crmState);
    }

    const newUser = await this.criarUsuarioColaborador(data, admin);

    if (isDoctor) {
      await this.doctorProfileRepository.create({
        userId: newUser.id,
        council,
        crm: data.crm?.trim() || null,
        crmState: data.crmState?.trim() || null,
        specialty: data.specialty || null,
      });
    }

    await this.vincularAoMedicoQueConvidou(newUser.id, admin);
    await this.enviarConviteDeColaborador(newUser, admin);

    const { permissions, isPlatformAdmin, ...newUserWithoutInternalFields } =
      newUser;

    return {
      ...omitUserSecrets(newUserWithoutInternalFields),
      permissions: resolveEffectivePermissions({
        role: newUser.role,
        permissions,
        isDoctor,
        isPhysician: isDoctor && council === ProfessionalCouncil.CRM,
      }),
    };
  }

  private async liberarContatoParaConvite(
    data: Pick<CreateCollaboratorDto, 'email' | 'phone'>,
  ): Promise<void> {
    const emailFound = await this.userRepository.findOneWithDeleted({
      email: data.email,
    });
    if (emailFound) {
      if (!emailFound.deletedAt) {
        throw new BadRequestException('Email já está em uso');
      }
      await this.userRepository.update(emailFound.id, {
        email: `deleted_${emailFound.email}_${emailFound.id}`,
      });
    }

    if (data.phone) {
      const phoneFound = await this.userRepository.findOne({
        phone: data.phone,
      });
      if (phoneFound) throw new BadRequestException('Telefone já está em uso');
    }
  }

  private async criarUsuarioColaborador(
    data: CreateCollaboratorDto,
    admin: User,
  ): Promise<User> {
    const placeholderPassword = generateValidationCode(16);
    try {
      return await this.userRepository.create({
        email: data.email,
        name: data.name,
        phone: data.phone,
        role: UserRole.COLLABORATOR,
        status: UserStatus.PENDING,
        password: await bcrypt.hash(placeholderPassword, BCRYPT_ROUNDS),
        ownerId: admin.ownerId,
        permissions: data.permissions ?? [],
      });
    } catch (err) {
      if (err instanceof QueryFailedError) {
        const detalhe = (err as QueryFailedError & { detail?: string }).detail;
        const msg = detalhe ?? err.message;
        if (msg.includes('email')) {
          throw new BadRequestException('Email já está em uso');
        }
        if (msg.includes('phone')) {
          throw new BadRequestException('Telefone já está em uso');
        }
      }
      throw err;
    }
  }

  private async vincularAoMedicoQueConvidou(
    newUserId: string,
    admin: User,
  ): Promise<void> {
    const adminDoctorProfile = await this.doctorProfileRepository.findByUserId(
      admin.id,
    );
    if (!adminDoctorProfile) return;
    await this.userDoctorAccessRepository.upsert({
      userId: newUserId,
      doctorUserId: admin.id,
      status: UserDoctorAccessStatus.ACTIVE,
      createdById: admin.id,
    });
  }

  private async enviarConviteDeColaborador(
    newUser: User,
    admin: User,
  ): Promise<void> {
    await this.recoveryCodeRepository.deleteMany({
      userId: newUser.id,
      used: false,
    });
    const inviteToken = randomUUID();
    await this.recoveryCodeRepository.create({
      userId: newUser.id,
      used: false,
      code: inviteToken,
      expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
    });

    const dashboardUrl = this.configService.get<string>('DASHBOARD_URL');
    const setupLink = `${dashboardUrl}/primeiro-acesso?email=${encodeURIComponent(newUser.email)}&token=${inviteToken}`;

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
  }

  async updateCollaborator(
    collaboratorId: string,
    data: UpdateCollaboratorDto,
    adminId: string,
  ) {
    const admin = await this.assertPodeGerirEquipe(adminId);
    const collaborator = await this.carregarColaboradorDaConta(
      collaboratorId,
      admin,
    );

    if (collaboratorId === adminId) {
      this.assertNaoMudaProprioVinculo(collaborator, data);
    }
    await this.assertContatoDisponivel(data, collaboratorId);

    const { terPerfil, councilFinal } =
      await this.sincronizarPerfilProfissional(
        collaboratorId,
        collaborator.doctorProfile ?? null,
        data,
      );

    const updated = await this.userRepository.update(
      collaboratorId,
      UsersService.montarAtualizacaoDoColaborador(data),
    );
    if (!updated) throw new NotFoundException('Colaborador não encontrado');

    if (
      data.permissions !== undefined ||
      data.isDoctor !== undefined ||
      data.council !== undefined
    ) {
      this.emitAccessChanged(collaboratorId, collaborator.phone);
    }

    const grantedPermissionsAfterUpdate =
      data.permissions !== undefined
        ? data.permissions
        : (collaborator.permissions ?? []);

    return {
      ...omitUserSecrets(updated),
      permissions: resolveEffectivePermissions({
        role: collaborator.role,
        permissions: grantedPermissionsAfterUpdate,
        isDoctor: terPerfil,
        isPhysician: terPerfil && councilFinal === ProfessionalCouncil.CRM,
      }),
      grantedPermissions: grantedPermissionsAfterUpdate,
    };
  }

  private async carregarColaboradorDaConta(
    collaboratorId: string,
    admin: User,
  ): Promise<User> {
    const collaborator = await this.userRepository.findOneWithProfile({
      id: collaboratorId,
    });
    if (!collaborator)
      throw new NotFoundException('Colaborador não encontrado');
    if (collaborator.ownerId !== admin.ownerId)
      throw new ForbiddenException('Este colaborador não pertence à sua conta');
    this.assertAlvoNaoEhDono({
      id: collaborator.id,
      ownerId: collaborator.ownerId,
    });
    return collaborator;
  }

  private assertNaoMudaProprioVinculo(
    collaborator: User,
    data: UpdateCollaboratorDto,
  ): void {
    const mudaVinculo =
      data.isDoctor !== undefined &&
      data.isDoctor !== !!collaborator.doctorProfile;
    const mudaConselho =
      data.council !== undefined &&
      !!collaborator.doctorProfile &&
      data.council !== collaborator.doctorProfile.council;
    if (mudaVinculo || mudaConselho) {
      throw new ForbiddenException(
        'Somente o dono da conta ou outro administrador altera o seu próprio vínculo profissional.',
      );
    }
  }

  private async assertContatoDisponivel(
    data: Pick<UpdateCollaboratorDto, 'email' | 'phone'>,
    collaboratorId: string,
  ): Promise<void> {
    if (data.email) {
      const emailFound = await this.userRepository.findOne({
        email: data.email,
        id: Not(collaboratorId),
      });
      if (emailFound) throw new BadRequestException('Email já está em uso');
    }

    if (data.phone) {
      const phoneFound = await this.userRepository.findOne({
        phone: data.phone,
        id: Not(collaboratorId),
      });
      if (phoneFound) throw new BadRequestException('Telefone já está em uso');
    }
  }

  private static montarAtualizacaoDoColaborador(
    data: UpdateCollaboratorDto,
  ): Partial<User> {
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
      updates.permissions = data.permissions;
    }
    return updates;
  }

  private async sincronizarPerfilProfissional(
    collaboratorId: string,
    perfilAtual: DoctorProfile | null,
    data: UpdateCollaboratorDto,
  ): Promise<{ terPerfil: boolean; councilFinal: ProfessionalCouncil }> {
    const hasProfile = !!perfilAtual;
    const profileUpdates: Partial<DoctorProfile> = {};
    if (data.council !== undefined) profileUpdates.council = data.council;
    if (data.crm !== undefined) profileUpdates.crm = data.crm?.trim() || null;
    if (data.crmState !== undefined)
      profileUpdates.crmState = data.crmState?.trim() || null;
    if (data.specialty !== undefined) profileUpdates.specialty = data.specialty;

    const terPerfil = data.isDoctor !== undefined ? data.isDoctor : hasProfile;
    const councilFinal =
      profileUpdates.council ?? perfilAtual?.council ?? ProfessionalCouncil.CRM;

    const mexeNoRegistro =
      data.council !== undefined ||
      data.crm !== undefined ||
      data.crmState !== undefined;
    if (terPerfil && (!hasProfile || mexeNoRegistro)) {
      const crmFinal =
        'crm' in profileUpdates ? profileUpdates.crm : perfilAtual?.crm;
      const ufFinal =
        'crmState' in profileUpdates
          ? profileUpdates.crmState
          : perfilAtual?.crmState;
      UsersService.assertRegistroDoConselho(councilFinal, crmFinal, ufFinal);
    }

    if (terPerfil && !perfilAtual) {
      await this.doctorProfileRepository.create({
        userId: collaboratorId,
        council: councilFinal,
        crm: profileUpdates.crm ?? null,
        crmState: profileUpdates.crmState ?? null,
        specialty: profileUpdates.specialty ?? null,
      });
    } else if (!terPerfil && perfilAtual) {
      await this.doctorProfileRepository.delete(perfilAtual.id);
    } else if (
      terPerfil &&
      perfilAtual &&
      Object.keys(profileUpdates).length > 0
    ) {
      await this.doctorProfileRepository.update(perfilAtual.id, profileUpdates);
    }

    return { terPerfil, councilFinal };
  }

  async deleteCollaborator(collaboratorId: string, adminId: string) {
    const admin = await this.assertPodeGerirEquipe(adminId);

    const collaborator = await this.userRepository.findOne({
      id: collaboratorId,
    });
    if (!collaborator)
      throw new NotFoundException('Colaborador não encontrado');
    if (collaborator.ownerId !== admin.ownerId)
      throw new ForbiddenException('Este colaborador não pertence à sua conta');
    this.assertAlvoNaoEhDono({
      id: collaborator.id,
      ownerId: collaborator.ownerId,
    });

    const originalPhone = collaborator.phone;

    await this.userRepository.update(collaboratorId, {
      email: `deleted_${collaborator.email}_${collaboratorId}`,
      phone: `DEL${collaboratorId.slice(0, 12)}`,
    });
    await this.userRepository.delete(collaboratorId);

    this.emitAccessChanged(collaboratorId, originalPhone);

    return { message: 'Colaborador desativado com sucesso' };
  }

  async bulkDeleteCollaborators(
    collaboratorIds: string[],
    adminId: string,
  ): Promise<{ deleted: number }> {
    const admin = await this.assertPodeGerirEquipe(adminId);

    const uniqueIds = [...new Set(collaboratorIds)];
    const collaborators = await this.userRepository.findCollaboratorsByIds(
      uniqueIds,
      admin.ownerId,
    );

    if (collaborators.length !== uniqueIds.length) {
      throw new NotFoundException(
        'Um ou mais colaboradores não foram encontrados.',
      );
    }

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

    await this.userRepository.bulkSoftDelete(uniqueIds);

    for (const collaborator of collaborators) {
      this.emitAccessChanged(collaborator.id, collaborator.phone);
    }

    return { deleted: uniqueIds.length };
  }

  async findDoctors(userId: string) {
    const admin = await this.assertPodeGerirEquipe(userId);

    const doctors = await this.userRepository.findDoctorsByOwnerId(
      admin.ownerId,
    );

    const records = await Promise.all(
      doctors.map(async (d) => ({
        id: d.id,
        name: d.name,
        email: d.email,
        phone: d.phone,
        role: d.role,
        status: d.status,
        ownerId: d.ownerId,
        doctorProfile: d.doctorProfile ?? null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        avatarUrl: await this.resolveStorageUrl(d.avatarUrl),
      })),
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
    if (collaborator.ownerId !== admin.ownerId)
      throw new ForbiddenException('Este colaborador não pertence à sua conta');
    this.assertAlvoNaoEhDono({
      id: collaborator.id,
      ownerId: collaborator.ownerId,
    });

    const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.userRepository.update(collaboratorId, { password: hashed });

    await this.refreshTokenStore.revokeAllForUser(collaborator.id);

    return { message: 'Senha redefinida com sucesso' };
  }

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

    await this.recoveryCodeRepository.deleteMany({
      userId: collaborator.id,
    });

    const inviteToken = generateValidationCode(6);
    await this.recoveryCodeRepository.create({
      userId: collaborator.id,
      used: false,
      code: inviteToken,
      expiresAt: new Date(Date.now() + INVITE_CODE_TTL_MS),
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

  async findCollaboratorById(collaboratorId: string, adminId: string) {
    const admin = await this.assertPodeGerirEquipe(adminId);

    const collaborator = await this.userRepository.findOneWithProfile({
      id: collaboratorId,
    });
    if (!collaborator)
      throw new NotFoundException('Colaborador não encontrado');
    if (collaborator.ownerId !== admin.ownerId)
      throw new ForbiddenException('Este colaborador não pertence à sua conta');

    const accesses =
      await this.userDoctorAccessRepository.findAllByUserId(collaboratorId);

    const { permissions, isPlatformAdmin, onboardingState, ...comCredenciais } =
      collaborator;
    const userWithoutPassword = omitUserSecrets(comCredenciais);

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
      isPhysician: isPhysicianProfile(collaborator.doctorProfile),
      doctorAccesses: accesses,
      permissions: permissionsOf({
        role: collaborator.role,
        permissions,
        doctorProfile: collaborator.doctorProfile,
      }),
      grantedPermissions: permissions ?? [],
    };
  }

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
    const permissoesRequesting = permissionsOf(requesting);
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

  async updateSignatureUrl(userId: string, signatureUrl: string) {
    const profile = await this.doctorProfileRepository.findByUserId(userId);
    if (!profile)
      throw new ForbiddenException(
        'Apenas médicos podem atualizar a assinatura digital.',
      );
    await this.doctorProfileRepository.update(profile.id, { signatureUrl });
  }

  private static assertRegistroDoConselho(
    council: ProfessionalCouncil,
    crm: string | null | undefined,
    crmState: string | null | undefined,
  ): void {
    if (
      council === ProfessionalCouncil.CRM &&
      (!crm?.trim() || !crmState?.trim())
    ) {
      throw new BadRequestException(
        'Número e UF do CRM são obrigatórios para médicos.',
      );
    }
  }

  private async resolveStorageUrl(
    path?: string | null,
  ): Promise<string | null> {
    if (!path) return null;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    try {
      return await this.storageService.getSignedUrl(path);
    } catch (err: unknown) {
      this.logger.warn(`Falha ao assinar URL do storage: ${errorMessage(err)}`);
      return null;
    }
  }
}
