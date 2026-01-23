import * as bcrypt from 'bcrypt';
import { FindOptionsWhere, Not } from 'typeorm';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { UpdateUserDto } from './dto/update-user.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { FindManyUsersDto } from './dto/find-many.dto';

import { UserRepository } from 'src/database/repositories/user.repository';
import { UserStatuses } from 'src/common';
import { EmailService } from 'src/shared/email/email.service';
import { CompleteRegisterDto } from './dto/complete-register.dto';
import { User } from 'src/database/entities/user.entity';

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
  ) {}

  async findMany(query: FindManyUsersDto, userId: number) {
    let where: FindOptionsWhere<User> = { profile: query.profile };

    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    where = { ...where, clinic_id: user.clinic_id };

    const [total, resp] = await Promise.all([
      this.userRepository.total(where),
      this.userRepository.findMany(where, query.skip, query.take),
    ]);

    return { total, records: resp };
  }

  async findOne(id: number, userId: number) {
    let where: FindOptionsWhere<User> = { id };

    if (!id) throw new BadRequestException('ID is required');

    const requestingUser = await this.userRepository.findOne({ id: userId });
    if (!requestingUser) throw new NotFoundException('User not found');

    where = { ...where, clinic_id: requestingUser.clinic_id };

    const user = await this.userRepository.findOne(where);
    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  async validateCompleteRegisterLink(userId: number) {
    let where: FindOptionsWhere<User> = {
      id: userId,
      status: UserStatuses.incomplete,
    };

    const user = await this.userRepository.findOne(where);
    if (!user) throw new BadRequestException('Invalid link');

    return user;
  }

  async completeRegister(data: CompleteRegisterDto, userId: number) {
    const user = await this.userRepository.findOne({
      id: userId,
      status: UserStatuses.incomplete,
    });
    if (!user) throw new BadRequestException('Invalid link');

    const phoneFound = await this.userRepository.findOne({
      phone: data.phone,
      id: Not(userId),
    });
    if (phoneFound) throw new BadRequestException('Phone in use');

    const docFound = await this.userRepository.findOne({
      document: data.document,
      id: Not(userId),
    });
    if (docFound) throw new BadRequestException('Document in use');

    const newUser = await this.userRepository.update(userId, {
      ...data,
      status: UserStatuses.active,
      password: await bcrypt.hashSync(data.password, 10),
    });

    delete newUser.password;

    return newUser;
  }

  async create(data: CreateUserDto, userId: number) {
    const user = await this.userRepository.findOne({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    const phoneFound = await this.userRepository.findOne({ phone: data.phone });
    if (phoneFound) throw new NotFoundException('Phone in use');

    const emailFound = await this.userRepository.findOne({ email: data.email });
    if (emailFound) throw new NotFoundException('Email in use');

    const password = generateRandomPassword();

    const newUser = await this.userRepository.create({
      ...data,
      password: await bcrypt.hashSync(password, 10),
    });

    delete newUser.password;

    this.emailService.send(
      newUser.email,
      'Bem-vindo a Inexci!',
      `
        <p>Olá, <strong>${newUser.name}</strong></p>
        <p>Você foi convidado a fazer parte da Inexci como gestor de solicitação cirúrgica. <a href='${process.env.DASHBOARD_URL}'>Clique aqui</a> para acessar a plataforma utilizando os dados abaixo:</p>
        <p><strong>E-mail: </strong>${newUser.email}</p>
        <p><strong>Senha: </strong>${password}</p>
        <br />
        <br />
        <p>Não consegue clicar no link? Utilize o link abaixo:<br /> ${process.env.DASHBOARD_URL}</p>
      `,
    );

    return newUser;
  }

  async update(data: UpdateUserDto, userId: number) {
    const requestingUser = await this.userRepository.findOne({ id: userId });
    if (!requestingUser) throw new NotFoundException('User not found');

    const user = await this.userRepository.findOne({
      id: data.id,
      clinic_id: requestingUser.clinic_id,
    });
    if (!user) throw new NotFoundException('User not found');

    const phoneFound = await this.userRepository.findOne({
      phone: data.phone,
      id: Not(data.id),
    });
    if (phoneFound) throw new NotFoundException('Phone in use');

    const emailFound = await this.userRepository.findOne({
      email: data.email,
      id: Not(data.id),
    });
    if (emailFound) throw new NotFoundException('Email in use');

    if (data.password) {
      data.password = await bcrypt.hashSync(data.password, 10);
    }

    const updatedUser = await this.userRepository.update(data.id, {
      ...data,
    });

    delete updatedUser.password;

    return updatedUser;
  }
}
