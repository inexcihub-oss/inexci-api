import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Log de eventos de webhook recebidos do gateway de pagamento.
 *
 * Serve a dois prop\u00f3sitos:
 * 1. Idempot\u00eancia: o Stripe pode reenviar webhooks; o par
 *    `(gatewayProvider, eventId)` \u00e9 \u00fanico, garantindo que o handler n\u00e3o
 *    processe o mesmo evento duas vezes.
 * 2. Auditoria: armazena o payload bruto + erros de processamento para
 *    investiga\u00e7\u00e3o posterior.
 */
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

  /**
   * Identificador do evento no gateway. Para gateways que n\u00e3o emitem
   * ID expl\u00edcito, o provider gera um ID est\u00e1vel a partir
   * de (event_type + resource_id).
   */
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
