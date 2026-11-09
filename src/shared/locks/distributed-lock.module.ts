import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DistributedLockService } from './distributed-lock.service';

@Module({
  imports: [ConfigModule],
  providers: [DistributedLockService],
  exports: [DistributedLockService],
})
export class DistributedLockModule {}
