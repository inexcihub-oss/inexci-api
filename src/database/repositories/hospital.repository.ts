import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Hospital } from '../entities/hospital.entity';
import { OwnedCatalogRepository } from './owned-catalog.repository';

@Injectable()
export class HospitalRepository extends OwnedCatalogRepository<Hospital> {
  constructor(private readonly dataSource: DataSource) {
    super(dataSource.getRepository(Hospital));
  }
}
