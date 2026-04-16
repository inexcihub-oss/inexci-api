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
import { Roles } from 'src/shared/decorators/roles.decorator';
import { UserRole } from 'src/database/entities/user.entity';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';
import { SuppliersService } from './suppliers.service';
import { FindManySupplierDto } from './dto/find-many-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  findAll(
    @Query() query: FindManySupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.findAll(query, user.userId);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  create(
    @Body() data: CreateSupplierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.create(data, user.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: UpdateSupplierDto) {
    return this.suppliersService.update(id, data);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  delete(@Param('id') id: string) {
    return this.suppliersService.delete(id);
  }
}
