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
import { SkipThrottle } from '@nestjs/throttler';
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

@ApiTags('Upload')
@ApiBearerAuth()
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
  @ApiOperation({ summary: 'Upload de um único arquivo' })
  @ApiConsumes('multipart/form-data')
  async uploadSingle(
    @UploadedFile() file: Express.Multer.File,
    @Body('folder') folder: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.uploadService.uploadFile(file, folder, user.ownerId ?? undefined);

    return {
      message: 'Arquivo enviado com sucesso',
      data: result,
    };
  }

  /**
   * Gera URL assinada para um arquivo existente
   * GET /upload/signed-url?path=avatars/uuid.png
   */
  @Get('signed-url')
  @SkipThrottle()
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
    );
    return { data: result };
  }

  @Post('multiple')
  @ApiOperation({ summary: 'Upload de múltiplos arquivos' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('files', 10))
  async uploadMultiple(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('folder') folder: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const results = await this.uploadService.uploadMultipleFiles(files, folder, user.ownerId ?? undefined);

    return {
      message: `${results.length} arquivo(s) enviado(s) com sucesso`,
      data: results,
    };
  }
}
