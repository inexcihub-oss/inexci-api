import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { SendMethod } from 'src/shared/constants/send-method';

/**
 * POST /surgery-requests/:id/send
 * Transição: PENDING → SENT
 */
export class SendRequestDto {
  @IsOptional()
  @IsBoolean()
  notifyPatient?: boolean;

  @IsEnum(SendMethod)
  method: SendMethod;

  @ValidateIf((o) => o.method === SendMethod.EMAIL)
  @IsOptional()
  @IsString()
  to?: string;

  @ValidateIf((o) => o.method === SendMethod.EMAIL)
  @IsOptional()
  @IsString()
  subject?: string;

  @ValidateIf((o) => o.method === SendMethod.EMAIL)
  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString({ each: true })
  attachments?: string[];

  @ValidateIf((o) => o.method === SendMethod.EMAIL)
  @IsOptional()
  @IsString()
  cc?: string;

  /** Quando true, anexa o documento de origem (`sc_creation_source`) em vez do PDF gerado. */
  @ValidateIf((o) => o.method === SendMethod.EMAIL)
  @IsOptional()
  @IsBoolean()
  useSourceDocument?: boolean;

  /**
   * Data (YYYY-MM-DD) em que a solicitação foi de fato enviada ao convênio —
   * só faz sentido em `method: "document"` ("Confirmar com documento de
   * origem"), quando o envio já aconteceu fora da plataforma e o usuário está
   * só refletindo o status aqui. Sem isso, `sentAt`/`lastStatusChangedAt`
   * assumiriam a data do clique, distorcendo o kanban e as métricas de
   * estagnação. Pode ser anterior à criação da SC (uso da plataforma como
   * histórico); o service só rejeita datas no futuro.
   */
  @ValidateIf((o) => o.method === SendMethod.DOCUMENT)
  @IsOptional()
  @IsDateString()
  sentAt?: string;
}
