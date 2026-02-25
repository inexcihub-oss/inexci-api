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
import { STORAGE_FOLDERS } from '../../config/storage.config';

const ALLOWED_FOLDERS = Object.values(STORAGE_FOLDERS);

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  /**
   * Upload de um único arquivo
   * POST /upload/single
   * Body: folder (obrigatório) — deve ser um dos valores de STORAGE_FOLDERS
   */
  @Post('single')
  @UseInterceptors(FileInterceptor('file'))
  async uploadSingle(
    @UploadedFile() file: Express.Multer.File,
    @Body('folder') folder: string,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    if (!folder || !ALLOWED_FOLDERS.includes(folder as any)) {
      throw new BadRequestException(
        `Pasta inválida. Valores permitidos: ${ALLOWED_FOLDERS.join(', ')}`,
      );
    }

    const result = await this.uploadService.uploadFile(file, folder);

    return {
      message: 'Arquivo enviado com sucesso',
      data: result,
    };
  }

  /**
   * Upload de múltiplos arquivos
   * POST /upload/multiple
   * Body: folder (obrigatório) — deve ser um dos valores de STORAGE_FOLDERS
   */
  @Post('multiple')
  @UseInterceptors(FilesInterceptor('files', 10))
  async uploadMultiple(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('folder') folder: string,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Nenhum arquivo foi enviado');
    }

    if (!folder || !ALLOWED_FOLDERS.includes(folder as any)) {
      throw new BadRequestException(
        `Pasta inválida. Valores permitidos: ${ALLOWED_FOLDERS.join(', ')}`,
      );
    }

    const results = await this.uploadService.uploadMultipleFiles(files, folder);

    return {
      message: `${results.length} arquivo(s) enviado(s) com sucesso`,
      data: results,
    };
  }
}
