import { Module } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import { UserRepository } from 'src/database/repositories/user.repository';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [SuppliersController],
  providers: [SuppliersService, UserRepository],
})
export class SuppliersModule {}
