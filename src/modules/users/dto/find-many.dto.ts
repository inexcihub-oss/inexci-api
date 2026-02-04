import { IsOptional, IsString, IsIn } from 'class-validator';
import { FindManySharedDto } from 'src/shared/dto/find-many.dto';
import { UserRole } from 'src/database/entities/user.entity';

export class FindManyUsersDto extends FindManySharedDto {
  @IsOptional()
  @IsString()
  @IsIn(Object.values(UserRole))
  role?: UserRole;
}
