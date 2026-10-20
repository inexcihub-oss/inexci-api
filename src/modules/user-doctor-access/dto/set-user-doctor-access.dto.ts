import { IsArray, IsUUID } from 'class-validator';

export class SetUserDoctorAccessDto {
  @IsArray()
  @IsUUID('4', { each: true })
  doctor_user_ids: string[];
}
