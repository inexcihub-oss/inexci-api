import { CompleteRegisterDto } from './dto/complete-register.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { FindManyUsersDto } from './dto/find-many.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateCollaboratorDto } from './dto/create-collaborator.dto';
import { UpdateCollaboratorDto } from './dto/update-collaborator.dto';
import { UpdateDoctorProfileDto } from './dto/update-doctor-profile.dto';
import { UsersService } from './users.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Roles } from 'src/shared/decorators/roles.decorator';
import { UserRole } from 'src/database/entities/user.entity';
import {
  CurrentUser,
  AuthenticatedUser,
} from 'src/shared/decorators/current-user.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async findMany(
    @Query() query: FindManyUsersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.findMany(query, user.userId);
  }

  @Get('one')
  async findOne(
    @Query() { id }: { id: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.findOne(id, user.userId);
  }

  @Get('profile')
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return await this.usersService.getProfile(user.userId);
  }

  @Put('profile')
  async updateProfile(
    @Body() data: UpdateProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.updateProfile(data, user.userId);
  }

  @Get('complete-register/validate-link')
  async validateCompleteRegisterLink(@CurrentUser() user: AuthenticatedUser) {
    return await this.usersService.validateCompleteRegisterLink(user.userId);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  async create(
    @Body() data: CreateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.create(data, user.userId);
  }

  @Post('complete-register')
  async completeRegister(
    @Body() data: CompleteRegisterDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.completeRegister(data, user.userId);
  }

  @Put()
  @Roles(UserRole.ADMIN)
  async update(
    @Body() data: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.update(data, user.userId);
  }

  @Patch(':id')
  async updateProfileById(
    @Param('id') id: string,
    @Body() data: UpdateProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.updateProfileById(id, data, user.userId);
  }

  // ============ PERFIL MÉDICO ============

  @Patch('doctor-profile/:id')
  async updateDoctorProfile(
    @Param('id') id: string,
    @Body() data: UpdateDoctorProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.updateDoctorProfileById(
      id,
      data,
      user.userId,
    );
  }

  // ============ COLABORADORES ============

  @Get('doctors')
  @Roles(UserRole.ADMIN)
  async findDoctors(@CurrentUser() user: AuthenticatedUser) {
    return await this.usersService.findDoctors(user.userId);
  }

  @Get('collaborators')
  @Roles(UserRole.ADMIN)
  async findCollaborators(@CurrentUser() user: AuthenticatedUser) {
    return await this.usersService.findCollaborators(user.userId);
  }

  @Get('collaborators/:id')
  @Roles(UserRole.ADMIN)
  async findCollaboratorById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.findCollaboratorById(id, user.userId);
  }

  @Post('collaborators')
  @Roles(UserRole.ADMIN)
  async createCollaborator(
    @Body() data: CreateCollaboratorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.createCollaborator(data, user.userId);
  }

  @Patch('collaborators/:id')
  @Roles(UserRole.ADMIN)
  async updateCollaborator(
    @Param('id') id: string,
    @Body() data: UpdateCollaboratorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.updateCollaborator(id, data, user.userId);
  }

  @Delete('collaborators/:id')
  @Roles(UserRole.ADMIN)
  async deleteCollaborator(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return await this.usersService.deleteCollaborator(id, user.userId);
  }
}
