import { CompleteRegisterDto } from './dto/complete-register.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { FindManyUsersDto } from './dto/find-many.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateDoctorProfileDto } from './dto/create-doctor-profile.dto';
import { UsersService } from './users.service';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
  async findOne(@Query() { id }: { id: string }, @Request() req) {
    return await this.usersService.findOne(id, req.user.userId);
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

  @Post('doctor-profile')
  async createDoctorProfile(
    @Body() data: CreateDoctorProfileDto,
    @Request() req,
  ) {
    return await this.usersService.createDoctorProfile(data, req.user.userId);
  }

  @Put()
  async update(@Body() data: UpdateUserDto, @Request() req) {
    return await this.usersService.update(data, req.user.userId);
  }

  @Patch(':id')
  async updateProfileById(
    @Param('id') id: string,
    @Body() data: UpdateProfileDto,
    @Request() req,
  ) {
    return await this.usersService.updateProfileById(id, data, req.user.userId);
  }
}
