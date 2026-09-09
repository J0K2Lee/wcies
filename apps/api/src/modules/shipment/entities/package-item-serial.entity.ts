import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PackageItemEntity } from './package-item.entity';
import { PackageItemSerialStatus } from '../enums/shipment.constants';

/**
 * Package item SERIAL (Sprint 4 task §18): the exact SN packed into a
 * package item for serial-tracked SKUs. A packed SN must already belong to
 * the order item's reservation (never another order's SN).
 *
 * Lifecycle (Sprint 4 follow-up): packed serials are VOIDED (not deleted) when
 * their package item is unpacked, so "which SN was packed where" stays
 * answerable. Only ACTIVE rows are unique per serial number (partial unique
 * index), which lets the same physical unit be packed again after it was
 * returned to stock by an interception.
 */
@Entity('package_item_serials')
@Index('uq_package_item_serials_serial_active', ['serialNumber'], {
  unique: true,
  where: "status = 'ACTIVE'",
})
@Index('idx_package_item_serials_package_item', ['packageItemId'])
@Index('idx_package_item_serials_package', ['packageId'])
@Index('idx_package_item_serials_order_item', ['orderItemId'])
@Index('idx_package_item_serials_status', ['status'])
export class PackageItemSerialEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'package_item_id' })
  packageItemId!: string;

  @Column({ type: 'uuid', name: 'package_id' })
  packageId!: string;

  @Column({ type: 'uuid', name: 'order_item_id' })
  orderItemId!: string;

  @Column({ type: 'uuid', name: 'sku_id' })
  skuId!: string;

  @Column({ type: 'varchar', length: 255, name: 'serial_number' })
  serialNumber!: string;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: PackageItemSerialStatus;

  @Column({ type: 'timestamptz', name: 'voided_at', nullable: true })
  voidedAt!: Date | null;

  @Column({ type: 'uuid', name: 'voided_by', nullable: true })
  voidedBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => PackageItemEntity, (item) => item.serials)
  @JoinColumn({ name: 'package_item_id' })
  packageItem?: PackageItemEntity;
}
