import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/database/entities/user.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { EmailService } from 'src/shared/email/email.service';
import { JwtService } from '@nestjs/jwt';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService, UserRepository, EmailService, JwtService],
  exports: [UsersService],
})
export class UsersModule {}
