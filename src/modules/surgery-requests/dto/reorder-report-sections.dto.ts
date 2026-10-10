import { IsArray, IsString } from 'class-validator';

export class ReorderReportSectionsDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}
