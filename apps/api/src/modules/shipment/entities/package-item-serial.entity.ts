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

/**
 * Package item SERIAL (Sprint 4 task §18): the exact SN packed into a
 * package item for serial-tracked SKUs. A packed SN must already belong to
 * the order item's reservation - packing another order's SN is rejected. The
 * serial number is globally UNIQUE: one physical unit lives in at most one
 * package (rows are removed when an interception unpacks the line).
 */
@Entity('package_item_serials')
@Index('uq_package_item_serials_serial', ['serialNumber'], { unique: true })
@Index('idx_package_item_serials_package_item', ['packageItemId'])
@Index('idx_package_item_serials_package', ['packageId'])
@Index('idx_package_item_serials_order_item', ['orderItemId'])
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

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => PackageItemEntity, (item) => item.serials)
  @JoinColumn({ name: 'package_item_id' })
  packageItem?: PackageItemEntity;
}
