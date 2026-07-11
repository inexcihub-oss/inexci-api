import { IsOptional, IsString, MaxLength } from 'class-validator';
import { FindManySharedDto } from 'src/shared/dto/find-many.dto';

export class FindManyPatientDto extends FindManySharedDto {
  /** Busca server-side por nome (acento-insensível), e-mail ou CPF. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
