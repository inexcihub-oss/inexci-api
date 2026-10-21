import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import {
  AuthenticatedUser,
  CurrentUser,
} from 'src/shared/decorators/current-user.decorator';
import { PaymentReceiptService } from '../services/payment-receipt.service';
import { PaymentReceiptPreviewDto } from '../dto/payment-receipt.dto';
import { ownerIdDe } from '../utils/owner';

@ApiTags('Financeiro')
@ApiBearerAuth()
@Controller('finance/payments')
@RequirePermission(Permission.FINANCEIRO)
export class PaymentReceiptController {
  constructor(private readonly receiptService: PaymentReceiptService) {}

  @Get(':id/receipt')
  @ApiOperation({ summary: 'Recibo do pagamento em PDF' })
  @ApiProduces('application/pdf')
  async receipt(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StreamableFile> {
    const pdf = await this.receiptService.pdf(ownerIdDe(user), user.userId, id);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `inline; filename="recibo-${id}.pdf"`,
      length: pdf.length,
    });
  }

  @Get(':id/receipt/preview')
  @ApiOperation({ summary: 'Prévia HTML do recibo do pagamento' })
  @ApiOkResponse({ type: PaymentReceiptPreviewDto })
  async preview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentReceiptPreviewDto> {
    return {
      html: await this.receiptService.preview(ownerIdDe(user), user.userId, id),
    };
  }
}
