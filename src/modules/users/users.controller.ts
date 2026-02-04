import { CompleteRegisterDto } from './dto/complete-register.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { FindManyUsersDto } from './dto/find-many.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';
import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Request,
} from '@nestjs/common';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async findMany(@Query() query: FindManyUsersDto, @Request() req) {
    return await this.usersService.findMany(query, req.user.userId);
  }

  @Get('one')
  async findOne(@Query() { id }: { id: number }, @Request() req) {
    return await this.usersService.findOne(+id, req.user.userId);
  }

  @Get('profile')
  async getProfile(@Request() req) {
    return await this.usersService.getProfile(req.user.userId);
  }

  @Put('profile')
  async updateProfile(@Body() data: UpdateProfileDto, @Request() req) {
    return await this.usersService.updateProfile(data, req.user.userId);
  }

  @Get('complete-register/validate-link')
  async validateCompleteRegisterLink(@Request() req) {
    return await this.usersService.validateCompleteRegisterLink(
      req.user.userId,
    );
  }

  @Post()
  async create(@Body() data: CreateUserDto, @Request() req) {
    return await this.usersService.create(data, req.user.userId);
  }

  @Post('complete-register')
  async completeRegister(@Body() data: CompleteRegisterDto, @Request() req) {
    return await this.usersService.completeRegister(data, req.user.userId);
  }

  @Put()
  async update(@Body() data: UpdateUserDto, @Request() req) {
    return await this.usersService.update(data, req.user.userId);
  }
}
