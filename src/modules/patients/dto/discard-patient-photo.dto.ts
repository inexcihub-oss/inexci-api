import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DiscardPatientPhotoDto {
  /** Caminho devolvido pelo upload (`patient-photos/<ownerId>/...`). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  path: string;
}
