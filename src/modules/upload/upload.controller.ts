import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
  Body,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  /**
   * Upload de um único arquivo
   * POST /upload/single
   */
  @Post('single')
  @UseInterceptors(FileInterceptor('file'))
  async uploadSingle(
    @UploadedFile() file: Express.Multer.File,
    @Body('folder') folder?: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    const result = await this.uploadService.uploadFile(
      file,
      folder || 'documents',
    );

    return {
      message: 'Arquivo enviado com sucesso',
      data: result,
    };
  }

  /**
   * Upload de múltiplos arquivos
   * POST /upload/multiple
   */
  @Post('multiple')
  @UseInterceptors(FilesInterceptor('files', 10)) // Máximo 10 arquivos
  async uploadMultiple(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('folder') folder?: string,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    const results = await this.uploadService.uploadMultipleFiles(
      files,
      folder || 'documents',
    );

    return {
      message: `${results.length} arquivo(s) enviado(s) com sucesso`,
      data: results,
    };
  }
}
