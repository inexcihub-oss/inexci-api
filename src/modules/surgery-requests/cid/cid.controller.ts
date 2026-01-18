import { Controller, Get, Query } from '@nestjs/common';
import { FindManyCidDto } from './dto/find-many-cid.controller.dto';
import { CidService } from './cid.service';

@Controller('surgery-requests/cid')
export class CidController {
  constructor(private readonly cidService: CidService) {}

  @Get()
  findAll(@Query() query: FindManyCidDto) {
    return this.cidService.findAll(query);
  }
}
