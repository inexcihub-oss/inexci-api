import { Global, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { Document } from '../entities/document.entity';
import { BaseRepository } from './base.repository';

export interface DocumentAccessScope {
  surgeryRequestId: string | null;
  clinicalRecordId: string | null;
  surgeryRequestDoctorId: string | null;
  clinicalRecordDoctorId: string | null;
}

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

  async findBySurgeryRequestId(surgeryRequestId: string): Promise<Document[]> {
    return await this.repository.find({
      where: { surgeryRequestId },
      order: { createdAt: 'DESC' },
    });
  }

  async findByPatientId(patientId: string): Promise<Document[]> {
    return await this.repository.find({
      where: { patientId },
      order: { createdAt: 'DESC' },
    });
  }

  async findByPatientIdForDoctors(
    patientId: string,
    doctorIds: string[],
  ): Promise<Document[]> {
    const query = this.repository
      .createQueryBuilder('doc')
      .leftJoin('doc.clinicalRecord', 'cr')
      .where('doc.patientId = :patientId', { patientId })
      .orderBy('doc.createdAt', 'DESC');

    if (doctorIds.length === 0) {
      query.andWhere('doc.clinicalRecordId IS NULL');
    } else {
      query.andWhere(
        '(doc.clinicalRecordId IS NULL OR cr.doctorId IN (:...doctorIds))',
        { doctorIds },
      );
    }

    return await query.getMany();
  }

  async findAccessScopesByUriAndOwner(
    uri: string,
    ownerId: string,
  ): Promise<DocumentAccessScope[]> {
    const rows = await this.repository
      .createQueryBuilder('doc')
      .leftJoin('doc.surgeryRequest', 'sr')
      .leftJoin('doc.patient', 'patient')
      .leftJoin('doc.clinicalRecord', 'cr')
      .select('doc.surgeryRequestId', 'surgeryRequestId')
      .addSelect('doc.clinicalRecordId', 'clinicalRecordId')
      .addSelect('sr.doctorId', 'surgeryRequestDoctorId')
      .addSelect('cr.doctorId', 'clinicalRecordDoctorId')
      .where('doc.uri = :uri', { uri })
      .andWhere(
        '(sr.ownerId = :ownerId OR patient.ownerId = :ownerId OR cr.ownerId = :ownerId)',
        { ownerId },
      )
      .getRawMany<DocumentAccessScope>();
    return rows;
  }
}
