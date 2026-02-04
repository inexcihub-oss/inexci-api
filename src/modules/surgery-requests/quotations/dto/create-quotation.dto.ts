import { Mask } from '@tboerc/maskfy';
import { Transform, Type } from 'class-transformer';
import { Allow, IsNumber, IsString, IsNotEmpty } from 'class-validator';

export class CreateQuotationDto {
  @IsString()
  @IsNotEmpty()
  surgery_request_id: string;
  @Allow()
  @Transform(({ value }) => {
    value.phone = Mask.phone.raw(value.phone);
    return value;
  })
  supplier: {
    name: string;
    email: string;
    phone: string;
  };
}
