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
import { SuppliersService } from './suppliers.service';
import { FindManySupplierDto } from './dto/find-many-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { BulkDeleteSuppliersDto } from './dto/bulk-delete-suppliers.dto';

@ApiTags('Fornecedores')
@ApiBearerAuth()
@Controller('suppliers')
// Cadastro transversal às quatro áreas: `@RequireAnyArea()` exige ao menos
// uma área (fail-closed p/ colaborador sem permissão) sem amarrar a uma
// específica. Criar e atualizar herdam essa regra: quem monta a solicitação
// precisa cadastrar o fornecedor de OPME que faltou, sem depender do admin.
// Só `delete`/`bulkDelete` seguem em `ADMINISTRACAO` — apagar um fornecedor
// afeta OPMEs e cotações que já o referenciam.
@RequireAnyArea()
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  @ApiOperation({ summary: 'Listar fornecedores' })
  findAll(
    @Query() query: FindManySupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.findAll(query, user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar fornecedor por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.suppliersService.findById(id, user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Criar fornecedor' })
  create(
    @Body() data: CreateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.create(data, user.userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar fornecedor' })
  update(
    @Param('id') id: string,
    @Body() data: UpdateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.update(id, data, user.userId);
  }

  @Delete(':id')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Excluir fornecedor (soft delete)' })
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.suppliersService.delete(id, user.userId);
  }

  @Post('bulk-delete')
  @RequirePermission(Permission.ADMINISTRACAO)
  @ApiOperation({ summary: 'Excluir fornecedores em lote (soft delete)' })
  bulkDelete(
    @Body() data: BulkDeleteSuppliersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.bulkDelete(data.ids, user.userId);
  }
}
