import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TussController } from './tuss.controller';
import { TussService } from './tuss.service';
import { Tuss } from 'src/database/entities/tuss.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Tuss])],
  controllers: [TussController],
  providers: [TussService],
  exports: [TussService],
})
export class TussModule {}
