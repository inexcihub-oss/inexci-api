import {
  Controller,
  Get,
  Post,
  Body,
  Request,
  Query,
  Put,
  UseInterceptors,
  UploadedFile,
  Delete,
  BadRequestException,
  Patch,
  Param,
} from '@nestjs/common';
import { SurgeryRequestsService } from './surgery-requests.service';
import { CreateSurgeryRequestDto } from './dto/create-surgery-request.dto';
import { CreateSurgeryRequestSimpleDto } from './dto/create-surgery-request-simple.dto';
import { FindManySurgeryRequestDto } from './dto/find-many.dto';
import { FindOneSurgeryRequestDto } from './dto/find-one.dto';
import { UpdateSurgeryRequestDto } from './dto/update-surgery-request.dto';
import { UpdateSurgeryRequestBasicDto } from './dto/update-surgery-request-basic.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { SendSurgeryRequestDto } from './dto/send-surgery-request.dto';
import { CreateSurgeryDateOptions } from './dto/create-surgery-date-options.dto';
import { ScheduleSurgeryRequestDto } from './dto/schedule-surgery-request.dto';
import { ToInvoiceDto } from './dto/to-invoice.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { InvoiceDto } from './dto/invoice.dto';
import { ReceiveDto } from './dto/receive.dto';
import { CreateContestSurgeryRequestDto } from './dto/create-contest-surgery-request.dto';
import { CreateComplaintDto } from './dto/create-complaint.dto';

@Controller('surgery-requests')
export class SurgeryRequestsController {
  constructor(
    private readonly surgeryRequestsService: SurgeryRequestsService,
  ) {}

  @Post()
  createSurgeryRequest(
    @Body() data: CreateSurgeryRequestSimpleDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.createSurgeryRequest(
      data,
      req.user.userId,
    );
  }

  @Post('/send')
  send(@Body() data: SendSurgeryRequestDto, @Request() req) {
    return this.surgeryRequestsService.send(data, req.user.userId);
  }

  @Post('/cancel')
  cancel(@Body() data: SendSurgeryRequestDto, @Request() req) {
    return this.surgeryRequestsService.cancel(data, req.user.userId);
  }

  @Post('/schedule')
  schedule(@Body() data: ScheduleSurgeryRequestDto, @Request() req) {
    return this.surgeryRequestsService.schedule(data, req.user.userId);
  }

  @Post('/to-invoice')
  toInvoice(@Body() data: ToInvoiceDto, @Request() req) {
    return this.surgeryRequestsService.toInvoice(data, req.user.userId);
  }

  @Post('invoice')
  @UseInterceptors(FileInterceptor('invoice_protocol'))
  invoice(
    @Body() data: InvoiceDto,
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.surgeryRequestsService.invoice(data, req.user.userId, file);
  }

  @Post('/receive')
  receive(@Body() data: ReceiveDto, @Request() req) {
    return this.surgeryRequestsService.receive(data, req.user.userId);
  }

  @Post('/surgery-dates')
  createDateOptions(@Body() data: CreateSurgeryDateOptions, @Request() req) {
    return this.surgeryRequestsService.createDateOptions(data, req.user.userId);
  }

  @Get()
  findAll(@Query() query: FindManySurgeryRequestDto, @Request() req) {
    return this.surgeryRequestsService.findAll(query, req.user.userId);
  }

  @Get('one')
  findOne(@Query() query: FindOneSurgeryRequestDto, @Request() req) {
    return this.surgeryRequestsService.findOne(query.id, req.user.userId);
  }

  @Put()
  update(@Body() data: UpdateSurgeryRequestDto, @Request() req) {
    return this.surgeryRequestsService.update(data, req.user.userId);
  }

  @Patch(':id/basic')
  updateBasic(
    @Param('id') id: string,
    @Body() data: UpdateSurgeryRequestBasicDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.updateBasic(
      { ...data, id: id },
      req.user.userId,
    );
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() data: UpdateStatusDto,
    @Request() req,
  ) {
    return this.surgeryRequestsService.updateStatus(
      id,
      data.status,
      req.user.userId,
    );
  }

  @Post('/contest')
  @UseInterceptors(FileInterceptor('contest_file'))
  contest(
    @Body() data: CreateContestSurgeryRequestDto,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    if (!file) {
      throw new BadRequestException('File "contest_file" is required.');
    }

    return this.surgeryRequestsService.contest(data, file, req.user.userId);
  }

  @Post('/complaint')
  complaint(@Body() data: CreateComplaintDto, @Request() req) {
    return this.surgeryRequestsService.complaint(data, req.user.userId);
  }

  @Get('/dateExpired')
  dateExpired(@Request() req) {
    return this.surgeryRequestsService.dateExpired();
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Request() req) {
    return this.surgeryRequestsService.approve(id, req.user.userId);
  }

  @Post(':id/deny')
  deny(
    @Param('id') id: string,
    @Body('cancel_reason') cancelReason: string,
    @Request() req,
  ) {
    return this.surgeryRequestsService.deny(id, cancelReason, req.user.userId);
  }

  @Post(':id/transition')
  transition(
    @Param('id') id: string,
    @Body('new_status') newStatus: number,
    @Request() req,
  ) {
    return this.surgeryRequestsService.transitionToStatus(
      id,
      newStatus,
      req.user.userId,
    );
  }
}
