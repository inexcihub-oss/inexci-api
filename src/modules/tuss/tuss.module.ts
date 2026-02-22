import { Module } from '@nestjs/common';
import { TussController } from './tuss.controller';
import { TussService } from './tuss.service';

@Module({
  controllers: [TussController],
  providers: [TussService],
  exports: [TussService],
})
export class TussModule {}
