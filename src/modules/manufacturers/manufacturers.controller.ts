import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  RequireAnyArea,
  RequirePermission,
} from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';
import { ManufacturersService } from './manufacturers.service';
import { FindManyManufacturerDto } from './dto/find-many-manufacturer.dto';
import { UpdateManufacturerDto } from './dto/update-manufacturer.dto';
import { CreateManufacturerDto } from './dto/create-manufacturer.dto';
import { BulkDeleteManufacturersDto } from './dto/bulk-delete-manufacturers.dto';

@ApiTags('Fabricantes')
@ApiBearerAuth()
@Controller('manufacturers')
// Cadastro transversal às quatro áreas: `@RequireAnyArea()` exige ao menos
// uma área (fail-closed p/ colaborador sem permissão) sem amarrar a uma
// específica. Métodos de escrita mantêm `@RequirePermission(ADMINISTRACAO)`.
@RequireAnyArea()
export class ManufacturersController {
  constructor(private readonly manufacturersService: ManufacturersService) {}

  @Get()
  @ApiOperation({ summary: 'Listar fabricantes' })
  findAll(
    @Query() query: FindManyManufacturerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manufacturersService.findAll(query, user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar fabricante por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.manufacturersService.findById(id, user.userId);
  }

  @Post()
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Criar fabricante' })
  create(
    @Body() data: CreateManufacturerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manufacturersService.create(data, user.userId);
  }

  @Patch(':id')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Atualizar fabricante' })
  update(
    @Param('id') id: string,
    @Body() data: UpdateManufacturerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manufacturersService.update(id, data, user.userId);
  }

  @Delete(':id')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Excluir fabricante (soft delete)' })
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.manufacturersService.delete(id, user.userId);
  }

  @Post('bulk-delete')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Excluir fabricantes em lote (soft delete)' })
  bulkDelete(
    @Body() data: BulkDeleteManufacturersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manufacturersService.bulkDelete(data.ids, user.userId);
  }
}
