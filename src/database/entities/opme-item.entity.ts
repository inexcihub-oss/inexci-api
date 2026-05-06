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

@Entity('opme_item')
export class OpmeItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surgery_request_id' })
  surgery_request_id: string;

  @Column({ type: 'varchar', length: 75 })
  name: string;

  @Column({ type: 'varchar', length: 75, nullable: true })
  brand: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'int', nullable: true })
  authorized_quantity: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // Relations
  @ManyToOne(() => SurgeryRequest, (request) => request.opme_items)
  @JoinColumn({ name: 'surgery_request_id' })
  surgery_request: SurgeryRequest;

  @ManyToMany(() => Supplier, (supplier) => supplier.opme_items, {
    eager: false,
  })
  @JoinTable({
    name: 'opme_item_supplier',
    joinColumn: { name: 'opme_item_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'supplier_id', referencedColumnName: 'id' },
  })
  suppliers: Supplier[];
}
