import * as bcrypt from 'bcryptjs';
import * as sanitizeHtml from 'sanitize-html';
import { FindOptionsWhere, Not, In, QueryFailedError } from 'typeorm';
import {
  BadRequestException,
  Logger,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
import { MailService } from 'src/shared/mail/mail.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { User, UserRole, UserStatus } from 'src/database/entities/user.entity';
import { DoctorProfile } from 'src/database/entities/doctor-profile.entity';
import { UserDoctorAccessRepository } from 'src/database/repositories/user-doctor-access.repository';
import { RecoveryCodeRepository } from 'src/database/repositories/recovery-code.repository';

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
  ) {}

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
      this.userRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records: resp };
  }

  async findOne(id: string, userId: string) {
    if (!id) throw new BadRequestException('ID é obrigatório');

    const requestingUser = await this.userRepository.findOne({ id: userId });
    if (!requestingUser) throw new NotFoundException('Usuário não encontrado');

    // Admin pode ver qualquer um da conta
    if (requestingUser.role === UserRole.ADMIN) {
      const user = await this.userRepository.findOne({ id });
      if (!user) throw new NotFoundException('Usuário não encontrado');
      return user;
    }

    // Médico (com doctorProfile) pode ver a si mesmo ou quem tem acesso
    const doctorProfile =
      await this.doctorProfileRepository.findByUserId(userId);
    if (doctorProfile) {
      if (id === userId) {
        const user = await this.userRepository.findOne({ id });
        if (!user) throw new NotFoundException('Usuário não encontrado');
        return user;
      }
      const accesses =
        await this.userDoctorAccessRepository.findActiveByDoctorUserId(userId);
      const accessUserIds = accesses.map((a) => a.userId);
      if (!accessUserIds.includes(id)) {
        throw new ForbiddenException('Sem permissão para ver este usuário');
      }
      const user = await this.userRepository.findOne({ id });
      if (!user) throw new NotFoundException('Usuário não encontrado');
      return user;
    }

    // Colaborador só pode ver a si mesmo
    if (id !== userId) {
      throw new ForbiddenException('Sem permissão para ver este usuário');
    }

    const user = await this.userRepository.findOne({ id });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    return user;
  }

  async getProfile(userId: string) {
    const user = await this.userRepository.findOneWithProfile({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    // Remove senha do retorno
    const { password, ...userWithoutPassword } = user;

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

    // Apenas admin ou o próprio usuário podem atualizar o perfil
    if (requesting.role !== UserRole.ADMIN && requestingUserId !== targetId) {
      throw new ForbiddenException('Sem permissão para atualizar este perfil');
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
    if (data.gender !== undefined) userUpdates.gender = data.gender;
    if (data.avatarUrl !== undefined) userUpdates.avatarUrl = data.avatarUrl;

    const updatedUser = await this.userRepository.update(targetId, userUpdates);
    return updatedUser;
  }

  async create(data: CreateUserDto, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    // Só admin pode criar usuários
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Apenas admins podem criar usuários');
    }

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

    const newUser = await this.userRepository.create({
      email: data.email,
      name: data.name,
      phone: data.phone,
      role: data.role || UserRole.COLLABORATOR,
      status: UserStatus.PENDING,
      password: await bcrypt.hash(placeholderPw, 10),
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
    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isPasswordValid)
      throw new BadRequestException('Senha atual incorreta');

    // Atualiza senha
    const hashedPassword = await bcrypt.hash(newPassword, 10);
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

    // Permitir acesso ao próprio usuário (se for médico) e ao Admin da conta
    const isSelf = requestingUserId === targetId;
    const isAdmin =
      requesting.role === UserRole.ADMIN &&
      (target.adminId === requestingUserId || isSelf);

    if (!isSelf && !isAdmin) {
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
    if (data.signature_image_url !== undefined)
      profileUpdates.signatureUrl = data.signature_image_url ?? null;

    await this.doctorProfileRepository.update(
      target.doctorProfile.id,
      profileUpdates,
    );

    const updated = await this.userRepository.findOneWithProfile({
      id: targetId,
    });
    return updated;
  }

  // ============ GESTÃO DE COLABORADORES ============

  async findCollaborators(userId: string, skip = 0, take = 50) {
    const admin = await this.userRepository.findOne({ id: userId });
    if (!admin) throw new NotFoundException('Usuário não encontrado');
    if (admin.role !== UserRole.ADMIN)
      throw new ForbiddenException('Apenas admins podem listar colaboradores');

    const collaborators = await this.userRepository.findByOwnerId(
      admin.ownerId,
      skip,
      take,
    );

    // Excluir o próprio admin da lista de colaboradores
    const filtered = collaborators.filter((c) => c.id !== userId);
    return { records: filtered };
  }

  async createCollaborator(data: CreateCollaboratorDto, adminId: string) {
    const admin = await this.userRepository.findOne({ id: adminId });
    if (!admin) throw new NotFoundException('Usuário não encontrado');
    if (admin.role !== UserRole.ADMIN)
      throw new ForbiddenException('Apenas admins podem criar colaboradores');

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

    const isDoctor = data.isDoctor || false;

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
        password: await bcrypt.hash(placeholderPassword, 10),
        ownerId: admin.ownerId,
        adminId: adminId,
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
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000), // 72 horas
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

    return newUser;
  }

  async updateCollaborator(
    collaboratorId: string,
    data: UpdateCollaboratorDto,
    adminId: string,
  ) {
    const admin = await this.userRepository.findOne({ id: adminId });
    if (!admin || admin.role !== UserRole.ADMIN)
      throw new ForbiddenException('Apenas admins podem editar colaboradores');

    const collaborator = await this.userRepository.findOneWithProfile({
      id: collaboratorId,
    });
    if (!collaborator)
      throw new NotFoundException('Colaborador não encontrado');
    if (collaborator.adminId !== adminId)
      throw new ForbiddenException('Este colaborador não pertence à sua conta');

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
          collaborator.doctorProfile.id,
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
            collaborator.doctorProfile.id,
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
          collaborator.doctorProfile.id,
          profileUpdates,
        );
      }
    }

    const updated = await this.userRepository.update(collaboratorId, updates);
    return updated;
  }

  async deleteCollaborator(collaboratorId: string, adminId: string) {
    const admin = await this.userRepository.findOne({ id: adminId });
    if (!admin || admin.role !== UserRole.ADMIN)
      throw new ForbiddenException('Apenas admins podem remover colaboradores');

    const collaborator = await this.userRepository.findOne({
      id: collaboratorId,
    });
    if (!collaborator)
      throw new NotFoundException('Colaborador não encontrado');
    if (collaborator.adminId !== adminId)
      throw new ForbiddenException('Este colaborador não pertence à sua conta');

    // Anonimiza email e telefone antes do soft-delete para liberar as constraints únicas,
    // preservando o valor original como histórico no próprio campo.
    await this.userRepository.update(collaboratorId, {
      email: `deleted_${collaborator.email}_${collaboratorId}`,
      phone: null,
    });
    await this.userRepository.delete(collaboratorId);
    return { message: 'Colaborador desativado com sucesso' };
  }

  // ============ MÉDICOS DA CONTA ============

  /**
   * Lista médicos da conta (users com doctorProfile na mesma conta)
   */
  async findDoctors(userId: string) {
    const admin = await this.userRepository.findOne({ id: userId });
    if (!admin) throw new NotFoundException('Usuário não encontrado');
    if (admin.role !== UserRole.ADMIN)
      throw new ForbiddenException('Apenas admins podem listar médicos');

    const doctors = await this.userRepository.findDoctorsByOwnerId(
      admin.ownerId,
    );

    return {
      records: doctors.map((d) => {
        const { password, ...rest } = d;
        return rest;
      }),
    };
  }

  async toggleCollaboratorStatus(collaboratorId: string, adminId: string) {
    const admin = await this.userRepository.findOne({ id: adminId });
    if (!admin || admin.role !== UserRole.ADMIN)
      throw new ForbiddenException(
        'Apenas admins podem alterar status de colaboradores',
      );

    const collaborator = await this.userRepository.findOne({
      id: collaboratorId,
    });
    if (!collaborator)
      throw new NotFoundException('Colaborador não encontrado');
    if (collaborator.adminId !== adminId)
      throw new ForbiddenException('Este colaborador não pertence à sua conta');

    const newStatus =
      collaborator.status === UserStatus.ACTIVE
        ? UserStatus.INACTIVE
        : UserStatus.ACTIVE;

    await this.userRepository.update(collaboratorId, { status: newStatus });
    return { status: newStatus };
  }

  async resetCollaboratorPassword(
    collaboratorId: string,
    newPassword: string,
    adminId: string,
  ) {
    const admin = await this.userRepository.findOne({ id: adminId });
    if (!admin || admin.role !== UserRole.ADMIN)
      throw new ForbiddenException('Apenas admins podem redefinir senhas');

    const collaborator = await this.userRepository.findOne({
      id: collaboratorId,
    });
    if (!collaborator)
      throw new NotFoundException('Colaborador não encontrado');
    if (collaborator.adminId !== adminId)
      throw new ForbiddenException('Este colaborador não pertence à sua conta');

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.userRepository.update(collaboratorId, { password: hashed });
    return { message: 'Senha redefinida com sucesso' };
  }

  /**
   * Reenvia o e-mail de convite (link de primeiro acesso) para um colaborador
   * que ainda não ativou a conta. Gera um novo token de 72h e invalida os
   * anteriores. Disponível apenas para colaboradores com status PENDING.
   */
  async resendCollaboratorInvite(collaboratorId: string, adminId: string) {
    const admin = await this.userRepository.findOne({ id: adminId });
    if (!admin || admin.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Apenas admins podem reenviar convites');
    }

    const collaborator = await this.userRepository.findOne({
      id: collaboratorId,
    });
    if (!collaborator) {
      throw new NotFoundException('Colaborador não encontrado');
    }
    if (collaborator.ownerId !== admin.ownerId) {
      throw new ForbiddenException('Este colaborador não pertence à sua conta');
    }
    if (collaborator.status !== UserStatus.PENDING) {
      throw new BadRequestException(
        'Este usuário já ativou a conta. Reenvio de convite só está disponível para convites pendentes.',
      );
    }
    if (!collaborator.email) {
      throw new BadRequestException(
        'Colaborador não possui e-mail cadastrado',
      );
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
    const admin = await this.userRepository.findOne({ id: adminId });
    if (!admin || admin.role !== UserRole.ADMIN)
      throw new ForbiddenException(
        'Apenas admins podem ver detalhes de colaboradores',
      );

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

    const { password, ...userWithoutPassword } = collaborator;

    return {
      ...userWithoutPassword,
      isDoctor: !!collaborator.doctorProfile,
      doctorAccesses: accesses,
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
}
