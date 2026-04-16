import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CreateDocumentKeyDto } from './dto/create-document-key.dto';
import { DocumentsKeyService } from './documents-key.service';
import { FindManyDocumentKeyDto } from './dto/find-many-dto';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@Controller('surgery-requests/documents-key')
export class DocumentsKeyController {
  constructor(private readonly documentsKeyService: DocumentsKeyService) {}

  @Post()
  create(
    @Body() data: CreateDocumentKeyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsKeyService.create(data, user.userId);
  }

  @Get()
  findAll(
    @Query() query: FindManyDocumentKeyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsKeyService.findAll(query, user.userId);
  }
}
