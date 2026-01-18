import { Module } from '@nestjs/common';

import { EmailService } from './email.service';
import { JwtService } from '@nestjs/jwt';

@Module({
  providers: [EmailService, JwtService],
  exports: [EmailService],
})
export class EmailModule {}
