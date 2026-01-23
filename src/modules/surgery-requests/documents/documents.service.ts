import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateDocumentDto } from './dto/create-document.dto';
import { StorageService } from 'src/shared/storage/storage.service';
import { DocumentRepository } from 'src/database/repositories/document.repository';
import { DeleteDocumentDto } from './dto/delete-document.dto';
import { DataSource } from 'typeorm';
import { Document } from 'src/database/entities/document.entity';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly documentRepository: DocumentRepository,
  ) {}

  async create(
    data: CreateDocumentDto,
    userId: number,
    file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File is required');

    const uri = await this.storageService.create(file, 'documents');

    const newDocument = await this.documentRepository.create({
      surgery_request_id: data.surgery_request_id,
      created_by: userId,
      key: data.key,
      name: data.name,
      uri,
    });

    return {
      ...newDocument,
      uri: await this.storageService.getSignedUrl(uri),
    };
  }

  async delete(data: DeleteDocumentDto) {
    const document = await this.documentRepository.findOneSimple({
      id: data.id,
    });
    if (!document) throw new BadRequestException('Document not found');

    return await this.dataSource.transaction(async (manager) => {
      const documentRepo = manager.getRepository(Document);

      await documentRepo.delete({
        id: data.id,
        key: data.key,
        surgery_request_id: data.surgery_request_id,
      });
    });
  }
}
