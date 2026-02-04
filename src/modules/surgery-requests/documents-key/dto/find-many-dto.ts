import { FindManySharedDto } from 'src/shared/dto/find-many.dto';

export class FindManyDocumentKeyDto extends FindManySharedDto {
  user_id: string;
}
