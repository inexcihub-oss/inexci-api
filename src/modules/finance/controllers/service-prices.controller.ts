import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { ServicePricesService } from '../services/service-prices.service';
import {
  CreateServicePriceDto,
  ResolveServicePriceQueryDto,
  ResolvedServicePriceDto,
  ServicePriceDto,
  UpdateServicePriceDto,
} from '../dto/service-price.dto';
import { ownerIdDe } from '../utils/owner';

@ApiTags('Financeiro')
@ApiBearerAuth()
@Controller('finance/service-prices')
@RequirePermission(Permission.FINANCEIRO)
export class ServicePricesController {
  constructor(private readonly servicePricesService: ServicePricesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar a tabela de preços' })
  @ApiOkResponse({ type: ServicePriceDto, isArray: true })
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<ServicePriceDto[]> {
    return this.servicePricesService.list(ownerIdDe(user));
  }

  @Get('resolve')
  @ApiOperation({ summary: 'Sugerir o preço de uma consulta particular' })
  @ApiOkResponse({ type: ResolvedServicePriceDto })
  resolve(
    @Query() query: ResolveServicePriceQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ResolvedServicePriceDto> {
    return this.servicePricesService.resolve(ownerIdDe(user), {
      doctorId: query.doctorId ?? null,
      type: query.type ?? null,
    });
  }

  @Post()
  @ApiOperation({ summary: 'Cadastrar preço' })
  @ApiOkResponse({ type: ServicePriceDto })
  create(
    @Body() dto: CreateServicePriceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ServicePriceDto> {
    return this.servicePricesService.create(ownerIdDe(user), user.userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar preço' })
  @ApiOkResponse({ type: ServicePriceDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServicePriceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ServicePriceDto> {
    return this.servicePricesService.update(
      ownerIdDe(user),
      user.userId,
      id,
      dto,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Excluir preço' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.servicePricesService.remove(ownerIdDe(user), id);
  }
}
