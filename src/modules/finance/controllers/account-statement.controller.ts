import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
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
import { AccountStatementService } from '../services/account-statement.service';
import {
  AccountStatementDto,
  AccountStatementQueryDto,
} from '../dto/account-statement.dto';
import { ownerIdDe } from '../utils/owner';
import { CONTENT_TYPE_CSV } from '../utils/csv';
import { arquivoCsv } from './finance-reports.controller';

@ApiTags('Financeiro')
@ApiBearerAuth()
@Controller('finance/accounts')
@RequirePermission(Permission.FINANCEIRO)
export class AccountStatementController {
  constructor(private readonly statementService: AccountStatementService) {}

  @Get(':id/statement')
  @ApiOperation({ summary: 'Extrato da conta financeira' })
  @ApiProduces('application/json', CONTENT_TYPE_CSV)
  @ApiOkResponse({ type: AccountStatementDto })
  async statement(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AccountStatementQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AccountStatementDto | StreamableFile> {
    const extrato = await this.statementService.statement(ownerIdDe(user), id, {
      from: query.from,
      to: query.to,
    });
    if (query.format !== 'csv') return extrato;
    return arquivoCsv(
      this.statementService.statementCsv(extrato),
      `extrato-${extrato.account.name}-${query.from}-${query.to}.csv`,
    );
  }
}
