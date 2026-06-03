import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';

import { User } from './user.entity';

/**
 * M\u00e9todo de pagamento de uma conta (cart\u00e3o tokenizado pelo gateway).
 *
 * IMPORTANTE: NUNCA armazenamos n\u00famero do cart\u00e3o, CVV ou data de validade.
 * Apenas o token devolvido pelo gateway + metadados de exibi\u00e7\u00e3o (brand,
 * last4, holder name, exp_month/year) para a UI.
 */
@Entity('payment_methods')
@Index('idx_payment_methods_owner_id', ['ownerId'])
export class PaymentMethod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK para `users.id` do admin dono da conta. */
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'gateway_provider', type: 'varchar', length: 30 })
  gatewayProvider: string;

  /** Token/ID do método de pagamento no Stripe (pm_xxx). */
  @Column({ name: 'gateway_token', type: 'varchar', length: 255 })
  gatewayToken: string;

  /** ID do customer no Stripe (cus_xxx). Necess\u00e1rio para criar novos PaymentMethods. */
  @Column({
    name: 'gateway_customer_id',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  gatewayCustomerId: string | null;

  @Column({ type: 'varchar', length: 30 })
  brand: string;

  @Column({ type: 'char', length: 4 })
  last4: string;

  @Column({ name: 'holder_name', type: 'varchar', length: 100 })
  holderName: string;

  @Column({ name: 'exp_month', type: 'smallint' })
  expMonth: number;

  @Column({ name: 'exp_year', type: 'smallint' })
  expYear: number;

  @Column({ name: 'is_default', type: 'boolean', default: true })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User;
}
