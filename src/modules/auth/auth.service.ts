import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { User, UserRole, UserStatus } from 'src/database/entities/user.entity';
import { HttpMessages } from 'src/common';
import { EmailService } from 'src/shared/email/email.service';
import { UserRepository } from 'src/database/repositories/user.repository';
import { RecoveryCodeRepository } from 'src/database/repositories/recovery_code.repository';
import { AuthDto } from './dto/auth.dto';
import { RegisterDto } from './dto/register.dto';
import { validationCodeDto } from './dto/validation-code.dto';
import { changePasswordDto } from './dto/change-password.dto';
import { ChangePasswordAuthenticatedDto } from './dto/change-password-authenticated.dto';

function generateValidationCode(length = 6) {
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let validationCode = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    validationCode += characters[randomIndex];
  }
  return validationCode;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly recoveryCodeRepository: RecoveryCodeRepository,
    private readonly emailService: EmailService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.userRepository.findOne(
      { email, status: UserStatus.ACTIVE },
      true,
    );

    if (user && password) {
      let isValid = await bcrypt.compare(password, user.password);

      if (isValid) return user;
      else
        throw new HttpException(
          HttpMessages.loginFailed,
          HttpStatus.BAD_REQUEST,
        );
    } else {
      throw new HttpException(HttpMessages.loginFailed, HttpStatus.BAD_REQUEST);
    }
  }

  async register(data: RegisterDto) {
    // Verifica se o email já existe
    const existingUser = await this.userRepository.findOne({
      email: data.email,
    });

    if (existingUser) {
      throw new HttpException(
        'Este e-mail já está cadastrado',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // Cria o usuário
    const user = await this.userRepository.create({
      name: data.name,
      email: data.email,
      password: hashedPassword,
      role: UserRole.DOCTOR, // Padrão para usuário que se registra
      status: UserStatus.ACTIVE,
      phone: null,
    });

    // Retorna dados do usuário e token
    return {
      user: {
        id: user.id.toString(),
        role: user.role,
        name: user.name,
        phone: user.phone,
        email: user.email,
        cpf: user.cpf,
        status: user.status,
        createdAt: user.created_at?.toISOString() || new Date().toISOString(),
        updatedAt: user.updated_at?.toISOString() || new Date().toISOString(),
      },
      access_token: this.jwtService.sign({ userId: user.id }),
    };
  }

  async login(user: AuthDto) {
    const result = await this.validateUser(user.email, user.password);

    if (result) {
      return {
        user: {
          id: result.id.toString(),
          role: result.role,
          name: result.name,
          phone: result.phone,
          email: result.email,
          cpf: result.cpf,
          status: result.status,
          createdAt:
            result.created_at?.toISOString() || new Date().toISOString(),
          updatedAt:
            result.updated_at?.toISOString() || new Date().toISOString(),
        },
        access_token: this.jwtService.sign({ userId: result.id }),
      };
    }
  }

  async me(userId: number) {
    const user = await this.userRepository.findOne({ id: userId });

    const dataToReturn = {
      id: user.id,
      role: user.role,
      name: user.name,
      phone: user.phone,
      email: user.email,
    };

    return dataToReturn;
  }

  async sendRecoveryPasswordEmail(email: string) {
    const user = await this.userRepository.findOne({ email });

    if (!user) throw new NotFoundException('User not found');

    const codeExists = await this.recoveryCodeRepository.findOne({
      user_id: user.id,
    });

    if (codeExists)
      throw new BadRequestException('Código já enviado por email');

    const validationCode = generateValidationCode();

    await this.recoveryCodeRepository.create({
      user_id: user.id,
      used: false,
      code: validationCode,
    });

    this.emailService.send(
      user.email,
      'Inexci - Recuperação de senha',
      `
      <p>Olá, <strong>${user.name}</strong></p>
      <p>Você solicitou a recuperação de senha. Para continuar, utilize o código abaixo:</p>
      <p><strong>${validationCode}</strong></p>
      <p>Se você não solicitou a recuperação de senha, por favor, ignore este e-mail.</p> 
      `,
    );

    return { message: 'E-mail enviado com sucesso' };
  }

  async validateRecoveryPasswordCode(data: validationCodeDto) {
    const validationCode = await this.recoveryCodeRepository.findOne({
      code: data.code,
      used: false,
    });

    if (!validationCode) throw new NotFoundException('Código inválido');

    await this.recoveryCodeRepository.update(
      { id: validationCode.id },
      { used: true },
    );

    return { message: 'Código validado com sucesso' };
  }

  async changePassword(data: changePasswordDto) {
    const user = await this.userRepository.findOne({ email: data.email });

    if (!user) throw new NotFoundException('User not found');

    const password = await bcrypt.hash(data.password, 10);

    await this.userRepository.update(user.id, { password: password });

    return { message: 'Senha alterada com sucesso' };
  }

  async changePasswordAuthenticated(
    data: ChangePasswordAuthenticatedDto,
    userId: number,
  ) {
    const user = await this.userRepository.findOne({ id: userId }, true);

    if (!user) throw new NotFoundException('Usuário não encontrado');

    // Verifica se a senha atual está correta
    const isPasswordValid = await bcrypt.compare(
      data.currentPassword,
      user.password,
    );

    if (!isPasswordValid) {
      throw new BadRequestException('Senha atual incorreta');
    }

    // Hash da nova senha
    const newPasswordHash = await bcrypt.hash(data.newPassword, 10);

    await this.userRepository.update(user.id, { password: newPasswordHash });

    return { message: 'Senha alterada com sucesso' };
  }
}
