import * as bcrypt from 'bcrypt';
import { FindOptionsWhere, Not, In } from 'typeorm';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';

import { UpdateUserDto } from './dto/update-user.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { FindManyUsersDto } from './dto/find-many.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateDoctorProfileDto } from './dto/create-doctor-profile.dto';
import { CreateCollaboratorDto } from './dto/create-collaborator.dto';
import { UpdateCollaboratorDto } from './dto/update-collaborator.dto';
import { UpdateDoctorProfileDto } from './dto/update-doctor-profile.dto';

import { UserRepository } from 'src/database/repositories/user.repository';
import { DoctorProfileRepository } from 'src/database/repositories/doctor-profile.repository';
import { EmailService } from 'src/shared/email/email.service';
import { StorageService } from 'src/shared/storage/storage.service';
import { WhatsappService } from 'src/shared/whatsapp/whatsapp.service';
import { CompleteRegisterDto } from './dto/complete-register.dto';
import { User, UserRole, UserStatus } from 'src/database/entities/user.entity';
import { SubscriptionPlan } from 'src/database/entities/subscription-plan.entity';
import { TeamMemberRepository } from 'src/database/repositories/team-member.repository';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

function generateRandomPassword(length = 6) {
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    password += characters[randomIndex];
  }
  return password;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly emailService: EmailService,
    private readonly teamMemberRepository: TeamMemberRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
    private readonly storageService: StorageService,
    @InjectRepository(SubscriptionPlan)
    private readonly subscriptionPlanRepo: Repository<SubscriptionPlan>,
    private readonly whatsappService: WhatsappService,
  ) {}

  /**
   * Lista usuários
   * - Admin: pode ver todos
   * - Médico: pode ver seus colaboradores
   * - Colaborador: só pode ver a si mesmo
   */
  async findMany(query: FindManyUsersDto, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    let where: FindOptionsWhere<User> = {};

    // Admin pode ver todos
    if (user.role === UserRole.ADMIN) {
      if (query.role) {
        where.role = query.role;
      }
    } else if (user.role === UserRole.DOCTOR) {
      // Médico pode ver seus colaboradores
      const teamMembers =
        await this.teamMemberRepository.findByDoctorId(userId);
      const collaboratorIds = teamMembers.map((tm) => tm.collaborator_id);
      where.id = In([userId, ...collaboratorIds]);
      if (query.role) {
        where.role = query.role;
      }
    } else {
      // Colaboradores só podem ver a si mesmos
      where.id = userId;
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

    // Admin pode ver qualquer um
    if (requestingUser.role === UserRole.ADMIN) {
      const user = await this.userRepository.findOne({ id });
      if (!user) throw new NotFoundException('Usuário não encontrado');
      return user;
    }

    // Médico pode ver a si mesmo ou seus colaboradores (via team_members)
    if (requestingUser.role === UserRole.DOCTOR) {
      if (id === userId) {
        const user = await this.userRepository.findOne({ id });
        if (!user) throw new NotFoundException('Usuário não encontrado');
        return user;
      }
      const teamMembers =
        await this.teamMemberRepository.findByDoctorId(userId);
      const collaboratorIds = teamMembers.map((tm) => tm.collaborator_id);
      if (!collaboratorIds.includes(id)) {
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
    const { password, ...userWithoutPassword } = user as any;

    // Gerar signed URL para assinatura do médico (bucket privado)
    const profile = userWithoutPassword.doctor_profile;
    if (profile?.signature_url && !profile.signature_url.startsWith('http')) {
      try {
        profile.signature_url = await this.storageService.getSignedUrl(
          profile.signature_url,
        );
      } catch {
        // manter path original se falhar
      }
    }

    return userWithoutPassword;
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
    if (data.birth_date) userUpdates.birth_date = new Date(data.birth_date);
    if (data.gender) userUpdates.gender = data.gender;
    if (data.avatar_url) userUpdates.avatar_url = data.avatar_url;

    const updatedUser = await this.userRepository.update(userId, userUpdates);

    // Se tiver signature_url, atualizar DoctorProfile
    if (data.signature_url !== undefined) {
      const docProfile =
        await this.doctorProfileRepository.findByUserId(userId);
      if (docProfile) {
        await this.doctorProfileRepository.update(docProfile.id, {
          signature_url: data.signature_url,
        });
      }
    }

    delete updatedUser.password;
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
    if (
      requesting.role !== UserRole.ADMIN &&
      requesting.role !== UserRole.DOCTOR &&
      requestingUserId !== targetId
    ) {
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
    if (data.birth_date !== undefined)
      userUpdates.birth_date = new Date(data.birth_date);
    if (data.gender !== undefined) userUpdates.gender = data.gender;
    if (data.avatar_url !== undefined) userUpdates.avatar_url = data.avatar_url;

    const updatedUser = await this.userRepository.update(targetId, userUpdates);
    delete updatedUser.password;
    return updatedUser;
  }

  async validateCompleteRegisterLink(userId: string) {
    const where: FindOptionsWhere<User> = {
      id: userId,
      status: UserStatus.PENDING,
    };

    const user = await this.userRepository.findOne(where);
    if (!user) throw new BadRequestException('Link inválido');

    return user;
  }

  async completeRegister(data: CompleteRegisterDto, userId: string) {
    const user = await this.userRepository.findOne({
      id: userId,
      status: UserStatus.PENDING,
    });
    if (!user) throw new BadRequestException('Link inválido');

    // Verifica telefone duplicado
    if (data.phone) {
      const phoneFound = await this.userRepository.findOne({
        phone: data.phone,
        id: Not(userId),
      });
      if (phoneFound) throw new BadRequestException('Telefone em uso');
    }

    // Verifica CPF duplicado
    if (data.cpf) {
      const cpfFound = await this.userRepository.findOne({
        cpf: data.cpf,
        id: Not(userId),
      });
      if (cpfFound) throw new BadRequestException('CPF em uso');
    }

    const newUser = await this.userRepository.update(userId, {
      phone: data.phone,
      cpf: data.cpf,
      status: UserStatus.ACTIVE,
      password: await bcrypt.hashSync(data.password, 10),
    });

    delete newUser.password;

    return newUser;
  }

  async create(data: CreateUserDto, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    // Só admin e médicos podem criar usuários
    if (user.role === UserRole.COLLABORATOR) {
      throw new ForbiddenException('Colaboradores não podem criar usuários');
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

    const password = generateRandomPassword();

    const newUser = await this.userRepository.create({
      email: data.email,
      name: data.name,
      phone: data.phone,
      role: data.role || UserRole.COLLABORATOR,
      status: UserStatus.PENDING,
      password: await bcrypt.hashSync(password, 10),
    });

    delete newUser.password;

    // Vincula o novo usuário à equipe do médico criador (se for médico)
    if (user.role === UserRole.DOCTOR) {
      await this.teamMemberRepository.save({
        doctor_id: userId,
        collaborator_id: newUser.id,
      });
    }

    // Envia email de boas-vindas
    this.emailService.send(
      newUser.email,
      'Bem-vindo a Inexci!',
      `
        <p>Olá, <strong>${newUser.name}</strong></p>
        <p>Você foi convidado a fazer parte da Inexci. <a href='${process.env.DASHBOARD_URL}'>Clique aqui</a> para acessar a plataforma utilizando os dados abaixo:</p>
        <p><strong>E-mail: </strong>${newUser.email}</p>
        <p><strong>Senha: </strong>${password}</p>
        <br />
        <br />
        <p>Não consegue clicar no link? Utilize o link abaixo:<br /> ${process.env.DASHBOARD_URL}</p>
      `,
    );

    // Envia WhatsApp de boas-vindas ao médico (assíncrono — não bloqueia o fluxo)
    if (newUser.role === UserRole.DOCTOR && newUser.phone) {
      this.whatsappService.sendDoctorWelcome(
        newUser.phone,
        newUser.name,
        newUser.email,
      );
    }

    return newUser;
  }

  async update(data: UpdateUserDto, userId: string) {
    const requestingUser = await this.userRepository.findOne({ id: userId });
    if (!requestingUser) throw new NotFoundException('Usuário não encontrado');

    // Só admin pode atualizar outros usuários
    if (requestingUser.role !== UserRole.ADMIN && data.id !== userId) {
      throw new ForbiddenException('Sem permissão para atualizar este usuário');
    }

    const user = await this.userRepository.findOne({ id: data.id });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    // Verifica telefone duplicado
    if (data.phone) {
      const phoneFound = await this.userRepository.findOne({
        phone: data.phone,
        id: Not(data.id),
      });
      if (phoneFound) throw new BadRequestException('Telefone em uso');
    }

    // Verifica email duplicado
    if (data.email) {
      const emailFound = await this.userRepository.findOne({
        email: data.email,
        id: Not(data.id),
      });
      if (emailFound) throw new BadRequestException('Email em uso');
    }

    const updateData: Partial<User> = { ...data };

    if (data.password) {
      updateData.password = await bcrypt.hashSync(data.password, 10);
    }

    const updatedUser = await this.userRepository.update(data.id, updateData);

    delete updatedUser.password;

    return updatedUser;
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    // Verifica senha atual
    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isPasswordValid)
      throw new BadRequestException('Senha atual incorreta');

    // Atualiza senha
    const hashedPassword = await bcrypt.hashSync(newPassword, 10);
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
      user_id: userId,
      specialty: dto.specialty,
      crm: dto.crm,
      crm_state: dto.crm_state,
      clinic_name: dto.clinic_name,
      clinic_cnpj: dto.clinic_cnpj,
      clinic_address: dto.clinic_address,
    });
  }

  // ============ PERFIL MÉDICO ============

  async updateDoctorProfileById(
    targetId: string,
    data: UpdateDoctorProfileDto,
    requestingUserId: string,
  ) {
    const requesting = await this.userRepository.findOne({
      id: requestingUserId,
    });
    if (!requesting) throw new NotFoundException('Usuário não encontrado');

    const target = await this.userRepository.findOne({ id: targetId });
    if (!target) throw new NotFoundException('Usuário alvo não encontrado');

    // Permitir acesso ao próprio usuário (se for médico) e ao Admin da conta
    const isSelf = requestingUserId === targetId;
    const isAdmin =
      requesting.is_admin && (target.admin_id === requestingUserId || isSelf);

    if (!isSelf && !isAdmin && requesting.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Sem permissão para atualizar este perfil médico',
      );
    }

    if (!target.is_doctor) {
      throw new BadRequestException('Este usuário não é médico');
    }

    const updates: Partial<User> = {};
    if (data.crm !== undefined) updates.crm = data.crm;
    if (data.crm_state !== undefined) updates.crm_state = data.crm_state;
    if (data.specialty !== undefined) updates.specialty = data.specialty;
    if (data.signature_image_url !== undefined)
      updates.signature_image_url = data.signature_image_url;

    const updated = await this.userRepository.update(targetId, updates);
    delete updated.password;
    return updated;
  }

  // ============ GESTÃO DE COLABORADORES ============

  /**
   * Verifica se o admin pode adicionar mais médicos ao plano
   */
  async canAddDoctor(adminId: string): Promise<boolean> {
    const admin = await this.userRepository.findOneWithProfile({
      id: adminId,
    });
    if (!admin || !admin.is_admin) return false;

    const plan = admin.subscription_plan;
    if (!plan) return false;

    // Contar médicos existentes vinculados a este admin
    let doctorCount = await this.userRepository.countDoctorsByAdminId(adminId);

    // Se o admin também é médico, ele conta como 1
    if (admin.is_doctor) {
      doctorCount += 1;
    }

    return doctorCount < plan.max_doctors;
  }

  async findCollaborators(userId: string, skip = 0, take = 50) {
    const admin = await this.userRepository.findOne({ id: userId });
    if (!admin) throw new NotFoundException('Usuário não encontrado');
    if (!admin.is_admin)
      throw new ForbiddenException('Apenas admins podem listar colaboradores');

    const collaborators = await this.userRepository.findManyByAdminId(
      userId,
      skip,
      take,
    );

    return { records: collaborators };
  }

  async createCollaborator(data: CreateCollaboratorDto, adminId: string) {
    const admin = await this.userRepository.findOne({ id: adminId });
    if (!admin) throw new NotFoundException('Usuário não encontrado');
    if (!admin.is_admin)
      throw new ForbiddenException('Apenas admins podem criar colaboradores');

    // Verifica email duplicado
    const emailFound = await this.userRepository.findOne({ email: data.email });
    if (emailFound) throw new BadRequestException('Email já está em uso');

    // Verifica telefone duplicado
    if (data.phone) {
      const phoneFound = await this.userRepository.findOne({
        phone: data.phone,
      });
      if (phoneFound) throw new BadRequestException('Telefone já está em uso');
    }

    // Se é médico, verificar limite do plano
    const isDoctor = data.is_doctor || false;
    if (isDoctor) {
      const canAdd = await this.canAddDoctor(adminId);
      if (!canAdd) {
        throw new BadRequestException(
          'Limite de médicos do plano atingido. Faça upgrade para adicionar mais médicos.',
        );
      }
    }

    const password = generateRandomPassword();

    const newUser = await this.userRepository.create({
      email: data.email,
      name: data.name,
      phone: data.phone,
      role: UserRole.COLLABORATOR,
      status: UserStatus.PENDING,
      password: await bcrypt.hash(password, 10),
      is_admin: false,
      is_doctor: isDoctor,
      crm: isDoctor ? data.crm : null,
      crm_state: isDoctor ? data.crm_state : null,
      specialty: isDoctor ? data.specialty : null,
      admin_id: adminId,
    });

    delete newUser.password;

    // Vincular como team member do admin (se admin é médico)
    if (admin.is_doctor || admin.role === UserRole.DOCTOR) {
      await this.teamMemberRepository.save({
        doctor_id: adminId,
        collaborator_id: newUser.id,
      });
    }

    // Envia email de boas-vindas
    this.emailService.send(
      newUser.email,
      'Bem-vindo a Inexci!',
      `
        <p>Olá, <strong>${newUser.name}</strong></p>
        <p>Você foi convidado por ${admin.name} a fazer parte da Inexci. <a href='${process.env.DASHBOARD_URL}'>Clique aqui</a> para acessar a plataforma utilizando os dados abaixo:</p>
        <p><strong>E-mail: </strong>${newUser.email}</p>
        <p><strong>Senha: </strong>${password}</p>
        <br />
        <p>Não consegue clicar no link? Utilize o link abaixo:<br /> ${process.env.DASHBOARD_URL}</p>
      `,
    );

    // Envia WhatsApp de boas-vindas ao médico recém-criado (assíncrono)
    if (isDoctor && newUser.phone) {
      this.whatsappService.sendDoctorWelcome(
        newUser.phone,
        newUser.name,
        newUser.email,
      );
    }

    return newUser;
  }

  async updateCollaborator(
    collaboratorId: string,
    data: UpdateCollaboratorDto,
    adminId: string,
  ) {
    const admin = await this.userRepository.findOne({ id: adminId });
    if (!admin || !admin.is_admin)
      throw new ForbiddenException('Apenas admins podem editar colaboradores');

    const collaborator = await this.userRepository.findOne({
      id: collaboratorId,
    });
    if (!collaborator)
      throw new NotFoundException('Colaborador não encontrado');
    if (collaborator.admin_id !== adminId)
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

    // Se está marcando como médico e não era antes, verificar limite
    if (data.is_doctor === true && !collaborator.is_doctor) {
      const canAdd = await this.canAddDoctor(adminId);
      if (!canAdd) {
        throw new BadRequestException('Limite de médicos do plano atingido.');
      }
    }

    const updates: Partial<User> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.email !== undefined) updates.email = data.email;
    if (data.phone !== undefined) updates.phone = data.phone;
    if (data.is_doctor !== undefined) {
      updates.is_doctor = data.is_doctor;
      if (data.is_doctor) {
        updates.crm = data.crm || collaborator.crm;
        updates.crm_state = data.crm_state || collaborator.crm_state;
        updates.specialty = data.specialty || collaborator.specialty;
      } else {
        updates.crm = null;
        updates.crm_state = null;
        updates.specialty = null;
      }
    } else {
      if (data.crm !== undefined) updates.crm = data.crm;
      if (data.crm_state !== undefined) updates.crm_state = data.crm_state;
      if (data.specialty !== undefined) updates.specialty = data.specialty;
    }

    const updated = await this.userRepository.update(collaboratorId, updates);
    delete updated.password;
    return updated;
  }

  async deleteCollaborator(collaboratorId: string, adminId: string) {
    const admin = await this.userRepository.findOne({ id: adminId });
    if (!admin || !admin.is_admin)
      throw new ForbiddenException('Apenas admins podem remover colaboradores');

    const collaborator = await this.userRepository.findOne({
      id: collaboratorId,
    });
    if (!collaborator)
      throw new NotFoundException('Colaborador não encontrado');
    if (collaborator.admin_id !== adminId)
      throw new ForbiddenException('Este colaborador não pertence à sua conta');

    await this.userRepository.delete(collaboratorId);
    return { message: 'Colaborador removido com sucesso' };
  }
}
