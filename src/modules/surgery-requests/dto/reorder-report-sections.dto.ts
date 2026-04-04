import { IsArray, IsString } from 'class-validator';

export class ReorderReportSectionsDto {
  /** Lista de IDs das seções na nova ordem desejada */
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}
