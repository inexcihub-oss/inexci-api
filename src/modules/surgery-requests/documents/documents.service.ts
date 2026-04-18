import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateDocumentDto } from './dto/create-document.dto';
import { StorageService } from 'src/shared/storage/storage.service';
import { DocumentRepository } from 'src/database/repositories/document.repository';
import { DeleteDocumentDto } from './dto/delete-document.dto';
import { DataSource } from 'typeorm';
import { executeInTransaction } from 'src/shared/utils/transaction.util';
import { Document } from 'src/database/entities/document.entity';
import { ERROR_MESSAGES } from 'src/shared/constants/error-messages';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly documentRepository: DocumentRepository,
  ) {}

  async create(
    data: CreateDocumentDto,
    userId: string,
    file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File is required');

    const storagePath = await this.storageService.create(file, data.folder);

    const newDocument = await this.documentRepository.create({
      surgery_request_id: data.surgery_request_id,
      created_by: userId,
      key: data.key,
      name: data.name,
      uri: storagePath,
    });

    return {
      ...newDocument,
      path: storagePath,
      uri: await this.storageService.getSignedUrl(storagePath),
    };
  }

  async delete(data: DeleteDocumentDto) {
    const document = await this.documentRepository.findOneSimple({
      id: data.id,
    });
    if (!document) throw new NotFoundException(ERROR_MESSAGES.DOCUMENT_NOT_FOUND);

    return await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const documentRepo = manager.getRepository(Document);

        // Deletar do banco de dados
        await documentRepo.delete({
          id: data.id,
          key: data.key,
          surgery_request_id: data.surgery_request_id,
        });

        // Deletar do Supabase Storage
        if (document.uri) {
          try {
            await this.storageService.delete(document.uri);
          } catch (error) {
            this.logger.error('Erro ao deletar arquivo do Supabase', error);
            // Não falha a transação se o arquivo não existir no storage
          }
        }
      },
      { logger: this.logger, operationName: 'deleteDocument' },
    );
  }
}
