import { FileInterceptor } from '@nestjs/platform-express';

import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
  Delete,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
} from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { DeleteDocumentDto } from './dto/delete-document.dto';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@ApiTags('Documentos da Solicitação')
@ApiBearerAuth()
@Controller('surgery-requests/documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @ApiOperation({ summary: 'Enviar documento' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('document', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  create(
    @Body() data: CreateDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documentsService.create(data, user.userId, user.ownerId as string, file);
  }

  @Delete()
  @ApiOperation({ summary: 'Excluir documento' })
  delete(@Body() data: DeleteDocumentDto) {
    return this.documentsService.delete(data);
  }
}
