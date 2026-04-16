import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CreateDocumentKeyDto } from './dto/create-document-key.dto';
import { DocumentsKeyService } from './documents-key.service';
import { FindManyDocumentKeyDto } from './dto/find-many-dto';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@ApiTags('Tipos de Documento')
@ApiBearerAuth()
@Controller('surgery-requests/documents-key')
export class DocumentsKeyController {
  constructor(private readonly documentsKeyService: DocumentsKeyService) {}

  @Post()
  @ApiOperation({ summary: 'Criar tipo de documento' })
  create(
    @Body() data: CreateDocumentKeyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsKeyService.create(data, user.userId);
  }

  @Get()
  @ApiOperation({ summary: 'Listar tipos de documento' })
  findAll(
    @Query() query: FindManyDocumentKeyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsKeyService.findAll(query, user.userId);
  }
}
