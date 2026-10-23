import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from 'src/shared/decorators/require-permission.decorator';
import { Permission } from 'src/shared/permissions';
import { limitesDeUpload } from 'src/shared/storage/limites-upload';
import {
  ClinicalTranscriptionService,
  MAX_AUDIO_DITADO_BYTES,
} from './clinical-transcription.service';
import { DitadoLiberadoGuard } from './ditado-liberado.guard';

@ApiTags('Ditado do prontuário')
@ApiBearerAuth()
@Controller('clinical-records/transcribe')
@RequirePermission(Permission.ATENDIMENTO)
export class ClinicalTranscriptionController {
  constructor(
    private readonly transcriptionService: ClinicalTranscriptionService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 60000, limit: 20 } })
  @ApiOperation({ summary: 'Transcrever o ditado de uma seção da ficha' })
  @ApiConsumes('multipart/form-data')
  @UseGuards(DitadoLiberadoGuard)
  @UseInterceptors(
    FileInterceptor('audio', limitesDeUpload(MAX_AUDIO_DITADO_BYTES)),
  )
  transcribe(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.transcriptionService.transcribe(file);
  }
}
