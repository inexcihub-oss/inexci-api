import { Injectable } from '@nestjs/common';
import { FindManyCidDto } from './dto/find-many-cid.controller.dto';
import * as cidData from '../../../utils/cid.json';

interface CidItem {
  codigo: string;
  descricao: string;
}

export interface CidResponse {
  id: string;
  description: string;
}

@Injectable()
export class CidService {
  private cidList: CidItem[];

  constructor() {
    this.cidList = (cidData as any).rows;
  }

  async findAll(query: FindManyCidDto) {
    const { search, skip = 0, take = 50 } = query;

    let filtered: CidItem[];

    if (!search || search.length < 2) {
      filtered = this.cidList;
    } else {
      const searchLower = search.toLowerCase();
      
      filtered = this.cidList.filter(
        (item) =>
          item.codigo.toLowerCase().includes(searchLower) ||
          item.descricao.toLowerCase().includes(searchLower)
      );
    }

    const total = filtered.length;
    const records = filtered.slice(skip, skip + take).map((item) => ({
      id: item.codigo,
      description: item.descricao,
    }));

    return { total, records };
  }
}
