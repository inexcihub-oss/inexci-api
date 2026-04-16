import * as bcrypt from 'bcrypt';
import { FindOptionsWhere, Not, In } from 'typeorm';
import {
  BadRequestException,
  Logger,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
import { DoctorProfile } from 'src/database/entities/doctor-profile.entity';
import { SubscriptionPlan } from 'src/database/entities/subscription-plan.entity';
import { UserDoctorAccessRepository } from 'src/database/repositories/user-doctor-access.repository';
import { UserDoctorAccessStatus } from 'src/database/entities/user-doctor-access.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { generateTemporaryPassword } from 'src/shared/utils';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  constructor(
    private readonly userRepository: UserRepository,
    private readonly emailService: EmailService,
    private readonly userDoctorAccessRepository: UserDoctorAccessRepository,
    private readonly doctorProfileRepository: DoctorProfileRepository,
    private readonly storageService: StorageService,
    @InjectRepository(SubscriptionPlan)
    private readonly subscriptionPlanRepo: Repository<SubscriptionPlan>,
    private readonly whatsappService: WhatsappService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Lista usuários
   * - Admin: pode ver todos da conta
   * - Médico (com doctor_profile): pode ver quem tem acesso via user_doctor_access
   * - Colaborador: só pode ver a si mesmo
   */
  async findMany(query: FindManyUsersDto, userId: string) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    let where: FindOptionsWhere<User> = {};

    // Admin pode ver todos da conta
    if (user.role === UserRole.ADMIN) {
      where.account_id = user.account_id;
      if (query.role) {
        where.role = query.role;
      }
    } else {
      // Verificar se é médico (tem doctor_profile) - pode ver quem tem acesso
      const doctorProfile =
        await this.doctorProfileRepository.findByUserId(userId);
      if (doctorProfile) {
        const accesses =
          await this.userDoctorAccessRepository.findActiveByDoctorUserId(
            userId,
          );
        const accessUserIds = accesses.map((a) => a.user_id);
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

    // Médico (com doctor_profile) pode ver a si mesmo ou quem tem acesso
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
      const accessUserIds = accesses.map((a) => a.user_id);
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
    if (data.birth_date !== undefined)
      userUpdates.birth_date = new Date(data.birth_date);
    if (data.gender !== undefined) userUpdates.gender = data.gender;
    if (data.avatar_url !== undefined) userUpdates.avatar_url = data.avatar_url;

    const updatedUser = await this.userRepository.update(targetId, userUpdates);
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
      password: await bcrypt.hash(data.password, 10),
    });

    return newUser;
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

    const password = generateTemporaryPassword();

    const newUser = await this.userRepository.create({
      email: data.email,
      name: data.name,
      phone: data.phone,
      role: data.role || UserRole.COLLABORATOR,
      status: UserStatus.PENDING,
      password: await bcrypt.hash(password, 10),
      account_id: user.account_id,
      admin_id: userId,
    });

    // Envia email de boas-vindas
    this.emailService.send(
      newUser.email,
      'Bem-vindo a Inexci!',
      `
        <p>Olá, <strong>${newUser.name}</strong></p>
        <p>Você foi convidado a fazer parte da Inexci. <a href='${this.configService.get<string>('DASHBOARD_URL')}'>Clique aqui</a> para acessar a plataforma utilizando os dados abaixo:</p>
        <p><strong>E-mail: </strong>${newUser.email}</p>
        <p><strong>Senha: </strong>${password}</p>
        <br />
        <br />
        <p>Não consegue clicar no link? Utilize o link abaixo:<br /> ${this.configService.get<string>('DASHBOARD_URL')}</p>
      `,
    );

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
      updateData.password = await bcrypt.hash(data.password, 10);
    }

    const updatedUser = await this.userRepository.update(data.id, updateData);

    return updatedUser;
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
      (target.admin_id === requestingUserId || isSelf);

    if (!isSelf && !isAdmin) {
      throw new ForbiddenException(
        'Sem permissão para atualizar este perfil médico',
      );
    }

    if (!target.doctor_profile) {
      throw new BadRequestException('Este usuário não é médico');
    }

    // Atualiza no DoctorProfile
    const profileUpdates: Partial<DoctorProfile> = {};
    if (data.crm !== undefined) profileUpdates.crm = data.crm;
    if (data.crm_state !== undefined) profileUpdates.crm_state = data.crm_state;
    if (data.specialty !== undefined) profileUpdates.specialty = data.specialty;
    if (data.signature_image_url !== undefined)
      profileUpdates.signature_url = data.signature_image_url;

    await this.doctorProfileRepository.update(
      target.doctor_profile.id,
      profileUpdates,
    );

    const updated = await this.userRepository.findOneWithProfile({
      id: targetId,
    });
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
    if (!admin || admin.role !== UserRole.ADMIN) return false;

    const plan = admin.subscription_plan;
    if (!plan) return false;

    // Contar médicos existentes na conta (users com doctor_profile)
    let doctorCount = await this.userRepository.countDoctorsByAccountId(
      admin.account_id,
    );

    return doctorCount < plan.max_doctors;
  }

  async findCollaborators(userId: string, skip = 0, take = 50) {
    const admin = await this.userRepository.findOne({ id: userId });
    if (!admin) throw new NotFoundException('Usuário não encontrado');
    if (admin.role !== UserRole.ADMIN)
      throw new ForbiddenException('Apenas admins podem listar colaboradores');

    const collaborators = await this.userRepository.findByAccountId(
      admin.account_id,
      skip,
      take,
    );

    return { records: collaborators };
  }

  async createCollaborator(data: CreateCollaboratorDto, adminId: string) {
    const admin = await this.userRepository.findOne({ id: adminId });
    if (!admin) throw new NotFoundException('Usuário não encontrado');
    if (admin.role !== UserRole.ADMIN)
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

    const password = generateTemporaryPassword();

    const newUser = await this.userRepository.create({
      email: data.email,
      name: data.name,
      phone: data.phone,
      role: UserRole.COLLABORATOR,
      status: UserStatus.PENDING,
      password: await bcrypt.hash(password, 10),
      account_id: admin.account_id,
      admin_id: adminId,
    });

    // Se é médico, criar doctor_profile
    if (isDoctor && data.crm && data.crm_state) {
      await this.doctorProfileRepository.create({
        user_id: newUser.id,
        crm: data.crm,
        crm_state: data.crm_state,
        specialty: data.specialty || null,
      });
    }

    // Envia email de boas-vindas
    this.emailService.send(
      newUser.email,
      'Bem-vindo a Inexci!',
      `
        <p>Olá, <strong>${newUser.name}</strong></p>
        <p>Você foi convidado por ${admin.name} a fazer parte da Inexci. <a href='${this.configService.get<string>('DASHBOARD_URL')}'>Clique aqui</a> para acessar a plataforma utilizando os dados abaixo:</p>
        <p><strong>E-mail: </strong>${newUser.email}</p>
        <p><strong>Senha: </strong>${password}</p>
        <br />
        <p>Não consegue clicar no link? Utilize o link abaixo:<br /> ${this.configService.get<string>('DASHBOARD_URL')}</p>
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
    if (!admin || admin.role !== UserRole.ADMIN)
      throw new ForbiddenException('Apenas admins podem editar colaboradores');

    const collaborator = await this.userRepository.findOneWithProfile({
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
    const hasProfile = !!collaborator.doctor_profile;
    if (data.is_doctor === true && !hasProfile) {
      const canAdd = await this.canAddDoctor(adminId);
      if (!canAdd) {
        throw new BadRequestException('Limite de médicos do plano atingido.');
      }
    }

    // Campos do usuário base
    const updates: Partial<User> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.email !== undefined) updates.email = data.email;
    if (data.phone !== undefined) updates.phone = data.phone;

    // Gestão do doctor_profile
    if (data.is_doctor !== undefined) {
      if (data.is_doctor && !hasProfile) {
        // Criar doctor_profile
        await this.doctorProfileRepository.create({
          user_id: collaboratorId,
          crm: data.crm || '',
          crm_state: data.crm_state || '',
          specialty: data.specialty || null,
        });
      } else if (!data.is_doctor && hasProfile) {
        // Remover doctor_profile
        await this.doctorProfileRepository.delete(
          collaborator.doctor_profile.id,
        );
      } else if (data.is_doctor && hasProfile) {
        // Atualizar doctor_profile
        const profileUpdates: Partial<DoctorProfile> = {};
        if (data.crm !== undefined) profileUpdates.crm = data.crm;
        if (data.crm_state !== undefined)
          profileUpdates.crm_state = data.crm_state;
        if (data.specialty !== undefined)
          profileUpdates.specialty = data.specialty;
        if (Object.keys(profileUpdates).length > 0) {
          await this.doctorProfileRepository.update(
            collaborator.doctor_profile.id,
            profileUpdates,
          );
        }
      }
    } else {
      // Atualizar campos médicos no doctor_profile se existem
      if (
        hasProfile &&
        (data.crm !== undefined ||
          data.crm_state !== undefined ||
          data.specialty !== undefined)
      ) {
        const profileUpdates: Partial<DoctorProfile> = {};
        if (data.crm !== undefined) profileUpdates.crm = data.crm;
        if (data.crm_state !== undefined)
          profileUpdates.crm_state = data.crm_state;
        if (data.specialty !== undefined)
          profileUpdates.specialty = data.specialty;
        await this.doctorProfileRepository.update(
          collaborator.doctor_profile.id,
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
    if (collaborator.admin_id !== adminId)
      throw new ForbiddenException('Este colaborador não pertence à sua conta');

    await this.userRepository.delete(collaboratorId);
    return { message: 'Colaborador desativado com sucesso' };
  }

  // ============ MÉDICOS DA CONTA ============

  /**
   * Lista médicos da conta (users com doctor_profile na mesma conta)
   */
  async findDoctors(userId: string) {
    const admin = await this.userRepository.findOne({ id: userId });
    if (!admin) throw new NotFoundException('Usuário não encontrado');
    if (admin.role !== UserRole.ADMIN)
      throw new ForbiddenException('Apenas admins podem listar médicos');

    const doctors = await this.userRepository.findDoctorsByAccountId(
      admin.account_id,
    );

    return {
      records: doctors.map((d) => {
        const { password, ...rest } = d;
        return rest;
      }),
    };
  }

  /**
   * Detalhes de um colaborador (dados + doctor_profile + user_doctor_access)
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
    if (collaborator.account_id !== admin.account_id)
      throw new ForbiddenException('Este colaborador não pertence à sua conta');

    // Buscar vínculos com médicos
    const accesses =
      await this.userDoctorAccessRepository.findAllByUserId(collaboratorId);

    const { password, ...userWithoutPassword } = collaborator;

    return {
      ...userWithoutPassword,
      is_doctor: !!collaborator.doctor_profile,
      doctor_accesses: accesses,
    };
  }
}
