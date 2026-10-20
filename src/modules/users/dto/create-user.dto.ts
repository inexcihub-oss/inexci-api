import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { UserRole } from 'src/database/entities/user.entity';
import { UserPhone } from 'src/shared/pipes/phone-mask.pipe';
import { NormalizeEmail } from 'src/shared/validators/normalize-email.decorator';

export class CreateUserDto {
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
  @NormalizeEmail()
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Telefone é obrigatório' })
  @UserPhone()
  phone: string;
}
