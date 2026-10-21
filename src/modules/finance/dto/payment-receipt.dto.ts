import { ApiProperty } from '@nestjs/swagger';

export class PaymentReceiptPreviewDto {
  @ApiProperty({ description: 'HTML do recibo, o mesmo usado no PDF' })
  html: string;
}
