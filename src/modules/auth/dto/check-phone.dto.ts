import { IsNotEmpty, IsString } from 'class-validator';
import { UserPhone } from 'src/shared/pipes/phone-mask.pipe';

export class CheckPhoneDto {
  @IsString()
  @IsNotEmpty()
  @UserPhone()
  phone: string;
}
