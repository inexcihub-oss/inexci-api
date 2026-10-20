import {
  Controller,
  Post,
  Get,
  Query,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  Body,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../shared/decorators/current-user.decorator';
import { MAX_STORAGE_FILE_SIZE } from '../../config/storage.config';
import { limitesDeUpload } from '../../shared/storage/limites-upload';

export const UPLOAD_MULTIPLO_MAX_ARQUIVOS = 5;

@ApiTags('Upload')
@ApiBearerAuth()
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('single')
  @UseInterceptors(
    FileInterceptor('file', limitesDeUpload(MAX_STORAGE_FILE_SIZE)),
  )
  @ApiOperation({ summary: 'Upload de um único arquivo' })
  @ApiConsumes('multipart/form-data')
  async uploadSingle(
    @UploadedFile() file: Express.Multer.File,
    @Body('folder') folder: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.uploadService.uploadFile(
      file,
      folder,
      user.ownerId ?? undefined,
    );

    return {
      message: 'Arquivo enviado com sucesso',
      data: result,
    };
  }

  @Get('signed-url')
  @ApiOperation({ summary: 'Gerar URL assinada para arquivo armazenado' })
  async getSignedUrl(
    @Query('path') filePath: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!filePath) {
      throw new BadRequestException('O parâmetro "path" é obrigatório');
    }
    const result = await this.uploadService.getSignedUrl(
      filePath,
      user.ownerId,
      user.userId,
    );
    return { data: result };
  }

  @Post('multiple')
  @ApiOperation({ summary: 'Upload de múltiplos arquivos' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor(
      'files',
      UPLOAD_MULTIPLO_MAX_ARQUIVOS,
      limitesDeUpload(MAX_STORAGE_FILE_SIZE, UPLOAD_MULTIPLO_MAX_ARQUIVOS),
    ),
  )
  async uploadMultiple(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('folder') folder: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const results = await this.uploadService.uploadMultipleFiles(
      files,
      folder,
      user.ownerId ?? undefined,
    );

    return {
      message: `${results.length} arquivo(s) enviado(s) com sucesso`,
      data: results,
    };
  }
}
