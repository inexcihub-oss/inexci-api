import { Mask } from '@tboerc/maskfy';
import { Transform, Type } from 'class-transformer';
import { Allow, IsNumber } from 'class-validator';

export class CreateQuotationDto {
  @Type(() => Number)
  @IsNumber()
  surgery_request_id: number;

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
