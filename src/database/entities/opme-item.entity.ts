import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  ManyToMany,
  JoinColumn,
  JoinTable,
} from 'typeorm';
import { SurgeryRequest } from './surgery-request.entity';
import { Supplier } from './supplier.entity';

@Entity('opme_items')
export class OpmeItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surgery_request_id', type: 'uuid' })
  surgeryRequestId: string;

  @Column({ type: 'varchar', length: 75 })
  name: string;

  @Column({ type: 'varchar', length: 75, nullable: true })
  brand: string | null;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ name: 'authorized_quantity', type: 'int', nullable: true })
  authorizedQuantity: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => SurgeryRequest, (request) => request.opmeItems)
  @JoinColumn({ name: 'surgery_request_id' })
  surgeryRequest: SurgeryRequest;

  @ManyToMany(() => Supplier, (supplier) => supplier.opmeItems, {
    eager: false,
  })
  @JoinTable({
    name: 'opme_item_suppliers',
    joinColumn: { name: 'opme_item_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'supplier_id', referencedColumnName: 'id' },
  })
  suppliers: Supplier[];
}
