import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CidController } from './cid.controller';
import { CidService } from './cid.service';
import { Cid } from 'src/database/entities/cid.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Cid])],
  controllers: [CidController],
  providers: [CidService],
  exports: [CidService],
})
export class CidModule {}
