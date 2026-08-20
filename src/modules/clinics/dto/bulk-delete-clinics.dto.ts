import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class BulkDeleteClinicsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  ids: string[];
}
