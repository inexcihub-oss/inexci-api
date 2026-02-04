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

import { UserRepository } from 'src/database/repositories/user.repository';
import { EmailService } from 'src/shared/email/email.service';
import { CompleteRegisterDto } from './dto/complete-register.dto';
import { User, UserRole, UserStatus } from 'src/database/entities/user.entity';
import { TeamMemberRepository } from 'src/database/repositories/team-member.repository';

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

    // Médico pode ver a si mesmo ou seus colaboradores
    // Colaborador só pode ver a si mesmo
    if (id !== userId) {
      // TODO: Verificar se é colaborador do médico via team_member
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

    // Se for médico e tiver campos de perfil médico, atualizar DoctorProfile
    // TODO: Implementar atualização do DoctorProfile separadamente

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
}
