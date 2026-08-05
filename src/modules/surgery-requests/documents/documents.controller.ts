import { FileInterceptor } from '@nestjs/platform-express';

import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
  Delete,
  UseGuards,
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
import { SurgeryRequestOwnerGuard } from 'src/shared/guards/surgery-request-owner.guard';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import { MAX_STORAGE_FILE_SIZE } from 'src/config/storage.config';

@ApiTags('Documentos da Solicitação')
@ApiBearerAuth()
@UseGuards(SurgeryRequestOwnerGuard)
@Controller('surgery-requests/documents')
@RequirePermission(Permission.SOLICITACOES)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @ApiOperation({ summary: 'Enviar documento' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    // Corte grosso pelo maior limite configurado; o limite por pasta é
    // aplicado no service (a pasta só é conhecida depois do parse do corpo).
    FileInterceptor('document', {
      limits: { fileSize: MAX_STORAGE_FILE_SIZE },
    }),
  )
  create(
    @Body() data: CreateDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documentsService.create(
      data,
      user.userId,
      user.ownerId as string,
      file,
    );
  }

  @Delete()
  @ApiOperation({ summary: 'Excluir documento' })
  delete(@Body() data: DeleteDocumentDto) {
    return this.documentsService.delete(data);
  }
}
