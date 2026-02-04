import { IsOptional } from "class-validator";
import { FindManySharedDto } from "src/shared/dto/find-many.dto";

export class FindManyCidDto extends FindManySharedDto {
    @IsOptional()
    search?: string;
}
