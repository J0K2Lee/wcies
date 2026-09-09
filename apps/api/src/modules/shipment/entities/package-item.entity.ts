import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PackageEntity } from './package.entity';
import { PackageItemSerialEntity } from './package-item-serial.entity';
import { PackageItemStatus, VoidSourceType } from '../enums/shipment.constants';

/**
 * Package ITEM (Sprint 4 task §11): quantities accumulate per
 * (package, order item) - one package holds multiple SKUs and an order's
 * picked goods may be split across several packages.
 *
 * Lifecycle (Sprint 4 follow-up): unpacking an intercepted line VOIDS the row
 * instead of deleting it, so the package-level audit trail matches the
 * shipment-level one. ACTIVE = still a valid component of the package (it does
 * NOT describe packing/shipping progress); VOIDED = retained audit history and
 * excluded from every quantity calculation.
 */
@Entity('package_items')
@Index('uq_package_items_package_order_item_active', ['packageId', 'orderItemId'], {
  unique: true,
  where: "status = 'ACTIVE'",
})
@Index('idx_package_items_package', ['packageId'])
@Index('idx_package_items_order_item', ['orderItemId'])
@Index('idx_package_items_status', ['status'])
export class PackageItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'package_id' })
  packageId!: string;

  @Column({ type: 'uuid', name: 'order_item_id' })
  orderItemId!: string;

  @Column({ type: 'uuid', name: 'sku_id' })
  skuId!: string;

  @Column({ type: 'numeric', precision: 18, scale: 3, default: '0' })
  quantity!: string;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: PackageItemStatus;

  @Column({ type: 'timestamptz', name: 'voided_at', nullable: true })
  voidedAt!: Date | null;

  @Column({ type: 'uuid', name: 'voided_by', nullable: true })
  voidedBy!: string | null;

  @Column({ type: 'varchar', length: 100, name: 'voided_by_name', nullable: true })
  voidedByName!: string | null;

  @Column({ type: 'text', name: 'void_reason', nullable: true })
  voidReason!: string | null;

  @Column({ type: 'varchar', length: 40, name: 'void_source_type', nullable: true })
  voidSourceType!: VoidSourceType | null;

  @Column({ type: 'uuid', name: 'void_source_id', nullable: true })
  voidSourceId!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => PackageEntity, (pkg) => pkg.items)
  @JoinColumn({ name: 'package_id' })
  package?: PackageEntity;

  @OneToMany(() => PackageItemSerialEntity, (serial) => serial.packageItem)
  serials?: PackageItemSerialEntity[];
}
