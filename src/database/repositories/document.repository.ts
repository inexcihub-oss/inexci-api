import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { Document } from '../entities/document.entity';
import { BaseRepository } from './base.repository';

@Global()
@Injectable()
export class DocumentRepository extends BaseRepository<Document> {
  constructor(
    @InjectRepository(Document)
    repository: Repository<Document>,
  ) {
    super(repository);
  }

  async create(data: Partial<Document>): Promise<Document> {
    const document = this.repository.create(data);
    const saved = await this.repository.save(document);

    return (await this.repository.findOne({
      where: { id: saved.id },
      relations: ['creator'],
      select: {
        id: true,
        creator: {
          id: true,
          name: true,
        },
      },
    }))!;
  }

  async findOneSimple(
    where: FindOptionsWhere<Document>,
  ): Promise<Document | null> {
    return await this.repository.findOne({ where });
  }

  /** Documentos anexados a uma solicitação cirúrgica. */
  async findBySurgeryRequestId(surgeryRequestId: string): Promise<Document[]> {
    return await this.repository.find({
      where: { surgeryRequestId },
      order: { createdAt: 'DESC' },
    });
  }

  /** Documentos de um paciente (exames/anexos do prontuário), mais recentes primeiro. */
  async findByPatientId(patientId: string): Promise<Document[]> {
    return await this.repository.find({
      where: { patientId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Valida posse de um documento pelo tenant. O vínculo pode ser via
   * solicitação cirúrgica, paciente ou ficha de atendimento — qualquer um
   * cujo ownerId case libera a signed URL.
   */
  async existsByUriAndOwner(uri: string, ownerId: string): Promise<boolean> {
    const count = await this.repository
      .createQueryBuilder('doc')
      .leftJoin('doc.surgeryRequest', 'sr')
      .leftJoin('doc.patient', 'patient')
      .leftJoin('doc.clinicalRecord', 'cr')
      .where('doc.uri = :uri', { uri })
      .andWhere(
        '(sr.ownerId = :ownerId OR patient.ownerId = :ownerId OR cr.ownerId = :ownerId)',
        { ownerId },
      )
      .getCount();
    return count > 0;
  }
}
