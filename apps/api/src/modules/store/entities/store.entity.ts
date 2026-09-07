import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** A seller account on a platform; platform-scoped by (platform_id, store_code). */
@Entity('stores')
@Index('uq_stores_platform_code', ['platformId', 'storeCode'], { unique: true })
export class StoreEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'platform_id' })
  platformId!: string;

  @Column({ type: 'varchar', length: 100, name: 'store_code' })
  storeCode!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 255, name: 'seller_id', nullable: true })
  sellerId!: string | null;

  @Column({ type: 'varchar', length: 10, name: 'default_currency', nullable: true })
  defaultCurrency!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'jsonb', nullable: true })
  settings!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
