import { IsString, IsNotEmpty } from 'class-validator';
export class FindOneSurgeryRequestDto {
  @IsString()
  @IsNotEmpty()
  id: string;
}
