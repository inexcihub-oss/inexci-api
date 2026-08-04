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

    // O SurgeryRequestOwnerGuard nao cobre esta rota: guards rodam antes dos
    // interceptors, entao o FileInterceptor ainda nao parseou o multipart e o
    // body chega vazio ao guard. A validacao precisa acontecer aqui.
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
    // Busca escopada pela SC: sem isto, o DELETE no banco nao afetava nada
    // (o WHERE composto nao casava) mas o arquivo da outra clinica era
    // apagado do R2 assim mesmo.
    const document = await this.documentRepository.findOneSimple({
      id: data.id,
      surgeryRequestId: data.surgeryRequestId,
    });
    if (!document)
      throw new NotFoundException(ERROR_MESSAGES.DOCUMENT_NOT_FOUND);

    return await executeInTransaction(
      this.dataSource,
      async (manager) => {
        const documentRepo = manager.getRepository(Document);

        // Deletar do banco de dados
        await documentRepo.delete({
          id: data.id,
          key: data.key,
          surgeryRequestId: data.surgeryRequestId,
        });

        if (document.uri) {
          try {
            await this.storageService.delete(document.uri);
          } catch (error) {
            // Não falha a transação se o arquivo não existir no storage —
            // falha tolerada/esperada, não é um problema acionável.
            this.logger.warn('Erro ao deletar arquivo do storage', error);
          }
        }
      },
      { logger: this.logger, operationName: 'deleteDocument' },
    );
  }
}
