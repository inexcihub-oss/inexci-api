import { Injectable } from '@nestjs/common';
import * as tussData from '../../utils/tuss.json';

interface TussItem {
  codigo: number;
  procedimento: string;
}

export interface TussResponse {
  id: string;
  tuss_code: string;
  name: string;
  active: boolean;
}

@Injectable()
export class TussService {
  private tussList: TussItem[];

  constructor() {
    this.tussList = (tussData as any).rows;
  }

  search(search?: string, limit: number = 50): TussResponse[] {
    let filtered: TussItem[];

    if (!search || search.length < 2) {
      filtered = this.tussList.slice(0, limit);
    } else {
      const searchLower = search.toLowerCase();
      
      filtered = this.tussList
        .filter(
          (item) =>
            item.codigo.toString().includes(searchLower) ||
            item.procedimento.toLowerCase().includes(searchLower)
        )
        .slice(0, limit);
    }

    // Formatar para o padrão esperado pelo frontend
    return filtered.map((item) => ({
      id: item.codigo.toString(),
      tuss_code: this.formatTussCode(item.codigo),
      name: item.procedimento,
      active: true,
    }));
  }

  private formatTussCode(codigo: number): string {
    const str = codigo.toString().padStart(10, '0');
    // Formato: XX.XX.XX.XXX-X
    return `${str.slice(0, 2)}.${str.slice(2, 4)}.${str.slice(4, 6)}.${str.slice(6, 9)}-${str.slice(9)}`;
  }
}
