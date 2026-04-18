import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FindManyCidDto } from './dto/find-many-cid.controller.dto';
import { CidService } from './cid.service';

@ApiTags('CID')
@ApiBearerAuth()
@Controller('surgery-requests/cid')
export class CidController {
  constructor(private readonly cidService: CidService) {}

  @Get()
  @ApiOperation({ summary: 'Buscar códigos CID' })
  findAll(@Query() query: FindManyCidDto) {
    return this.cidService.findAll(query);
  }
}
