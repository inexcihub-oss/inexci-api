import { Transform } from 'class-transformer';
import { Allow, IsString, IsNotEmpty } from 'class-validator';
import { stripObjectPhoneMask } from 'src/shared/pipes/phone-mask.pipe';

export class CreateQuotationDto {
  @IsString()
  @IsNotEmpty()
  surgery_request_id: string;
  @Allow()
  @Transform(({ value }) => stripObjectPhoneMask(value))
  supplier: {
    name: string;
    email: string;
    phone: string;
  };
}
