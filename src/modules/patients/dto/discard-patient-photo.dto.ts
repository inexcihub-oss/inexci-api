import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DiscardPatientPhotoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  path: string;
}
