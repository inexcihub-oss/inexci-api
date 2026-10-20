import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('payment_gateway_events')
@Index(
  'idx_payment_gateway_events_provider_event',
  ['gatewayProvider', 'eventId'],
  { unique: true },
)
@Index('idx_payment_gateway_events_processed_at', ['processedAt'])
export class PaymentGatewayEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'gateway_provider', type: 'varchar', length: 30 })
  gatewayProvider: string;

  @Column({ name: 'event_id', type: 'varchar', length: 200 })
  eventId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 60 })
  eventType: string;

  @Column({ type: 'jsonb' })
  payload: unknown;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
