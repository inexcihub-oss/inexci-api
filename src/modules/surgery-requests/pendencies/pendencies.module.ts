import { Module } from '@nestjs/common';
import { PendenciesService } from './pendencies.service';
import { PendenciesController } from './pendencies.controller';
import { PendencyRepository } from 'src/database/repositories/pendency.repository';
import { UsersModule } from 'src/modules/users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [PendenciesController],
  providers: [PendenciesService, PendencyRepository],
  exports: [PendenciesService],
})
export class PendenciesModule {}
