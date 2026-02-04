import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/database/entities/user.entity';
import { TeamMember } from 'src/database/entities/team-member.entity';
import { UserRepository } from 'src/database/repositories/user.repository';
import { TeamMemberRepository } from 'src/database/repositories/team-member.repository';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { EmailService } from 'src/shared/email/email.service';
import { JwtService } from '@nestjs/jwt';

@Module({
  imports: [TypeOrmModule.forFeature([User, TeamMember])],
  controllers: [UsersController],
  providers: [
    UsersService,
    UserRepository,
    TeamMemberRepository,
    EmailService,
    JwtService,
  ],
  exports: [UsersService],
})
export class UsersModule {}
