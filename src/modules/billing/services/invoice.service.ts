import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InvoiceRepository } from 'src/database/repositories/invoice.repository';
import { UserRepository } from 'src/database/repositories/user.repository';
import { Invoice } from 'src/database/entities/invoice.entity';

@Injectable()
export class InvoiceService {
  constructor(
    private readonly invoiceRepo: InvoiceRepository,
    private readonly userRepo: UserRepository,
  ) {}

  async listMine(
    userId: string,
    skip = 0,
    take = 50,
  ): Promise<{ records: Invoice[]; total: number }> {
    const owner = await this.assertOwner(userId);
    return this.invoiceRepo.findByOwnerId(owner.id, skip, take);
  }

  private async assertOwner(userId: string) {
    const user = await this.userRepo.findOne({ id: userId });
    if (!user) throw new NotFoundException('Usu\u00e1rio n\u00e3o encontrado');
    if (user.id !== user.ownerId) {
      throw new ForbiddenException(
        'Apenas o admin da conta pode acessar as faturas',
      );
    }
    return user;
  }
}
