import { FileInterceptor } from '@nestjs/platform-express';

import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
  Delete,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { DeleteDocumentDto } from './dto/delete-document.dto';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@Controller('surgery-requests/documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('document'))
  create(
    @Body() data: CreateDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documentsService.create(data, user.userId, file);
  }

  @Delete()
  delete(@Body() data: DeleteDocumentDto) {
    return this.documentsService.delete(data);
  }
}
