import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateDocumentDto } from './dto/create-document.dto';
import { StorageService } from 'src/shared/storage/storage.service';
import { DocumentRepository } from 'src/database/repositories/document.repository';
import { PendenciesService } from '../pendencies/pendencies.service';
import { DeleteDocumentDto } from './dto/delete-document.dto';
import { DataSource } from 'typeorm';
import { PendencyRepository } from 'src/database/repositories/pendency.repository';
import { Document } from 'src/database/entities/document.entity';
import { Pendency } from 'src/database/entities/pendency.entity';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly pendenciesService: PendenciesService,
    private readonly documentRepository: DocumentRepository,
    private readonly pendencyRepository: PendencyRepository,
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

    await this.pendenciesService.close({
      surgery_request_id: data.surgery_request_id,
      key: `${data.key}`,
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

    const pendency = await this.pendencyRepository.findOneSimple({
      surgery_request_id: data.surgery_request_id,
      key: data.key,
    });
    if (!pendency) throw new BadRequestException('Pendency not found');

    return await this.dataSource.transaction(async (manager) => {
      const documentRepo = manager.getRepository(Document);
      const pendencyRepo = manager.getRepository(Pendency);

      await Promise.all([
        documentRepo.delete({
          id: data.id,
          key: data.key,
          surgery_request_id: data.surgery_request_id,
        }),

        pendencyRepo.update({ id: pendency.id }, { concluded_at: null }),
      ]);
    });
  }
}
