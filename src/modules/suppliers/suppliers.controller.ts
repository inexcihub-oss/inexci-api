import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Request,
} from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { FindManySupplierDto } from './dto/find-many-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  findAll(@Query() query: FindManySupplierDto, @Request() req) {
    return this.suppliersService.findAll(query, req.user.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: UpdateSupplierDto) {
    return this.suppliersService.update(id, data);
  }
}
