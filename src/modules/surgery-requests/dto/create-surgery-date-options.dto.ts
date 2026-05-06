import { IsString, IsNotEmpty, IsArray } from 'class-validator';
export class CreateSurgeryDateOptions {
  @IsString()
  @IsNotEmpty()
  id: string;
  @IsArray()
  dates: string[];
}
