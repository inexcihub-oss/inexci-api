import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/database/entities/user.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import { AccountStatusService } from './account-status.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UserRepository, AccountStatusService],
  exports: [AccountStatusService],
})
export class AccountStatusModule {}
