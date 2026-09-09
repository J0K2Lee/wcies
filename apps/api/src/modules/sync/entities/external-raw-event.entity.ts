import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * External raw event (Sprint 5 task §26/§27): webhook payloads persisted
 * BEFORE processing, with hash-based dedup when the platform supplies no
 * event id (OZON does not - verified in docs/integrations/ozon.md).
 */
@Entity('external_raw_events')
@Index('uq_external_raw_events_store_payload', ['storeId', 'payloadHash'], { unique: true })
@Index('uq_external_raw_events_store_event_id', ['storeId', 'externalEventId'], {
  unique: true,
  where: `external_event_id IS NOT NULL`,
})
@Index('idx_external_raw_events_received', ['receivedAt'])
export class ExternalRawEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 30 })
  platform!: string;

  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  @Column({ type: 'varchar', length: 60, name: 'event_type' })
  eventType!: string;

  @Column({ type: 'varchar', length: 255, name: 'external_event_id', nullable: true })
  externalEventId!: string | null;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 64, name: 'payload_hash' })
  payloadHash!: string;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: string;

  @Column({ type: 'timestamptz', name: 'received_at' })
  receivedAt!: Date;

  @Column({ type: 'timestamptz', name: 'processed_at', nullable: true })
  processedAt!: Date | null;

  @Column({ type: 'varchar', length: 60, name: 'error_code', nullable: true })
  errorCode!: string | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage!: string | null;
}
