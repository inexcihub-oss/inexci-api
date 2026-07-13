import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExtractFromDocumentResponseDto } from './extract-from-document-response.dto';

export class ExtractFromDocumentQueuedResponseDto {
  @ApiProperty({
    description: 'Identificador do job na fila de extração de documento.',
    example: '6f0c4fe7-a3ae-4ca7-88eb-c95d0ab8d2e1',
  })
  jobId: string;

  @ApiProperty({ enum: ['processing'], example: 'processing' })
  status: 'processing';
}

export class ExtractFromDocumentProcessingStatusDto {
  @ApiProperty({ enum: ['processing'], example: 'processing' })
  status: 'processing';
}

export class ExtractFromDocumentDoneStatusDto {
  @ApiProperty({ enum: ['done'], example: 'done' })
  status: 'done';

  @ApiProperty({ type: ExtractFromDocumentResponseDto })
  result: ExtractFromDocumentResponseDto;
}

export class ExtractFromDocumentErrorStatusDto {
  @ApiProperty({ enum: ['error'], example: 'error' })
  status: 'error';

  @ApiPropertyOptional({
    example: 'Não foi possível processar o documento. Tente novamente.',
  })
  message?: string;
}

export type ExtractFromDocumentJobStatusResponseDto =
  | ExtractFromDocumentProcessingStatusDto
  | ExtractFromDocumentDoneStatusDto
  | ExtractFromDocumentErrorStatusDto;
