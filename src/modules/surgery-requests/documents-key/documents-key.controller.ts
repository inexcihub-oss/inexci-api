import { Body, Controller, Get, Post, Query, Request } from "@nestjs/common";
import { CreateDocumentKeyDto } from "./dto/create-document-key.dto";
import { DocumentsKeyService } from "./documents-key.service";
import { FindManySurgeryRequestDto } from "../dto/find-many.dto";
import { FindManyDocumentKeyDto } from "./dto/find-many-dto";

@Controller('surgery-requests/documents-key')
export class DocumentsKeyController {
    constructor(private readonly documentsKeyService: DocumentsKeyService) {}

    @Post()
      create(@Body() data:CreateDocumentKeyDto, @Request() req) {
        return this.documentsKeyService.create(data, req.user.userId)
      }

    @Get()
      findAll(@Query() query: FindManyDocumentKeyDto , @Request() req) {
        return this.documentsKeyService.findAll(query, req.user.userId);
      }

}