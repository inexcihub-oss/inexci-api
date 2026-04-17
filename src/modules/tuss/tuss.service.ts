import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Tuss } from 'src/database/entities/tuss.entity';

export interface TussResponse {
  id: string;
  tuss_code: string;
  name: string;
  active: boolean;
}

@Injectable()
export class TussService {
  constructor(
    @InjectRepository(Tuss)
    private readonly tussRepository: Repository<Tuss>,
  ) {}

  async search(search?: string, limit: number = 50): Promise<TussResponse[]> {
    const where: any[] = [];

    if (search && search.length >= 2) {
      where.push({ code: ILike(`%${search}%`) });
      where.push({ procedure: ILike(`%${search}%`) });
    }

    const records = await this.tussRepository.find({
      where: where.length > 0 ? where : undefined,
      take: limit,
      order: { code: 'ASC' },
    });

    // Formatar para o padrão esperado pelo frontend
    return records.map((item) => ({
      id: item.id,
      tuss_code: this.formatTussCode(item.code),
      name: item.procedure,
      active: true,
    }));
  }

  private formatTussCode(codigo: string): string {
    const str = codigo.padStart(10, '0');
    // Formato: XX.XX.XX.XXX-X
    return `${str.slice(0, 2)}.${str.slice(2, 4)}.${str.slice(4, 6)}.${str.slice(6, 9)}-${str.slice(9)}`;
  }
}
