import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import {
  AuthenticatedUser,
  CurrentUser,
} from 'src/shared/decorators/current-user.decorator';
import { FinancialAccountsService } from '../services/financial-accounts.service';
import {
  CreateFinancialAccountDto,
  FinancialAccountDto,
  FindFinancialAccountsDto,
  UpdateFinancialAccountDto,
  UpdateFinancialAccountStatusDto,
} from '../dto/financial-account.dto';
import { ownerIdDe } from '../utils/owner';

@ApiTags('Financeiro')
@ApiBearerAuth()
@Controller('finance/accounts')
@RequirePermission(Permission.FINANCEIRO)
export class AccountsController {
  constructor(private readonly accountsService: FinancialAccountsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar contas financeiras' })
  @ApiOkResponse({ type: FinancialAccountDto, isArray: true })
  findAll(
    @Query() query: FindFinancialAccountsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FinancialAccountDto[]> {
    return this.accountsService.list(
      ownerIdDe(user),
      query.includeInactive === true,
    );
  }

  @Post()
  @ApiOperation({ summary: 'Criar conta financeira' })
  @ApiOkResponse({ type: FinancialAccountDto })
  create(
    @Body() dto: CreateFinancialAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FinancialAccountDto> {
    return this.accountsService.create(ownerIdDe(user), user.userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar conta financeira' })
  @ApiOkResponse({ type: FinancialAccountDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFinancialAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FinancialAccountDto> {
    return this.accountsService.update(ownerIdDe(user), user.userId, id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Ativar ou desativar conta financeira' })
  @ApiOkResponse({ type: FinancialAccountDto })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFinancialAccountStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FinancialAccountDto> {
    return this.accountsService.setStatus(
      ownerIdDe(user),
      user.userId,
      id,
      dto.active,
    );
  }
}
