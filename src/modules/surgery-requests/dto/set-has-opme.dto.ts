import { IsBoolean } from 'class-validator';

export class SetHasOpmeDto {
  @IsBoolean()
  hasOpme: boolean;
}
