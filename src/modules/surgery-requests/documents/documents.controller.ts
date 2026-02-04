import { FileInterceptor } from '@nestjs/platform-express';

import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
  Request,
  Delete,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { DeleteDocumentDto } from './dto/delete-document.dto';

@Controller('surgery-requests/documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('document'))
  create(
    @Body('surgery_request_id') surgery_request_id: string,
    @Body('key') key: string,
    @Body('name') name: string,
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const data: CreateDocumentDto = {
      surgery_request_id,
      key,
      name,
    };
    return this.documentsService.create(data, req.user.userId, file);
  }

  @Delete()
  delete(@Body() data: DeleteDocumentDto) {
    return this.documentsService.delete(data);
  }

}
