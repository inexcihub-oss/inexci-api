import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { UserRole } from 'src/database/entities/user.entity';
import { PhoneTransform } from 'src/shared/pipes/phone-mask.pipe';

export class CreateUserDto {
  /**
   * Só `collaborator` é aceito aqui. `POST /users` é gateado por
   * Permission.ADMINISTRACAO — que o admin delegado também tem — então
   * permitir `role: 'admin'` deixaria qualquer delegado cunhar um segundo
   * dono para a própria conta (o novo usuário herdaria `ownerId` de quem
   * criou, não `self.id`, quebrando a invariante "para admin, ownerId =
   * self.id" usada em todo o isolamento de tenant). Ver
   * `UsersService.create`, que também ignora este campo por segurança.
   */
  @IsOptional()
  @Type(() => String)
  @IsString()
  @IsIn([UserRole.COLLABORATOR])
  role?: UserRole;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Telefone é obrigatório' })
  @PhoneTransform()
  phone: string;
}
