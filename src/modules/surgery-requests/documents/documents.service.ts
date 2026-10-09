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
import { STORAGE_FOLDER_SIZE_LIMITS } from 'src/config/storage.config';
import { SurgeryRequestAccessValidator } from 'src/shared/services/surgery-request-access.validator';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly documentRepository: DocumentRepository,
    private readonly accessValidator: SurgeryRequestAccessValidator,
  ) {}

  async create(
    data: CreateDocumentDto,
    userId: string,
    ownerId: string,
    file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File is required');

    const sizeLimit = STORAGE_FOLDER_SIZE_LIMITS[data.folder];
    const fileSize = file.size ?? file.buffer?.length ?? 0;
    if (sizeLimit !== undefined && fileSize > sizeLimit) {
      throw new BadRequestException(
        `Arquivo excede o tamanho máximo permitido para esta pasta (${Math.round(sizeLimit / 1024)} KB)`,
      );
    }

    await this.accessValidator.validateAndFetch(data.surgeryRequestId, userId);

    const storagePath = await this.storageService.create(
      file,
      data.folder,
      ownerId,
    );

    const newDocument = await this.documentRepository.create({
      surgeryRequestId: data.surgeryRequestId,
      createdById: userId,
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

  async createFromPath(data: {
    surgeryRequestId: string;
    storagePath: string;
    type: string;
    name: string;
    key: string;
    contentType: string;
    createdById: string;
  }): Promise<Document> {
    const newDocument = await this.documentRepository.create({
      surgeryRequestId: data.surgeryRequestId,
      createdById: data.createdById,
      key: data.key,
      name: data.name,
      type: data.type,
      uri: data.storagePath,
    });

    return newDocument;
  }

  async delete(data: DeleteDocumentDto) {
    const document = await this.documentRepository.findOneSimple({
      id: data.id,
      surgeryRequestId: data.surgeryRequestId,
    });
    if (!document || document.key !== data.key)
      throw new NotFoundException(ERROR_MESSAGES.DOCUMENT_NOT_FOUND);

    return await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const documentRepo = manager.getRepository(Document);

        const result = await documentRepo.delete({
          id: data.id,
          key: data.key,
          surgeryRequestId: data.surgeryRequestId,
        });

        if (!result.affected) {
          throw new NotFoundException(ERROR_MESSAGES.DOCUMENT_NOT_FOUND);
        }

        if (document.uri) {
          try {
            await this.storageService.delete(document.uri);
          } catch (error) {
            this.logger.warn('Erro ao deletar arquivo do storage', error);
          }
        }
      },
      { logger: this.logger, operationName: 'deleteDocument' },
    );
  }
}
