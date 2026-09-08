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

/**
 * Package ITEM (Sprint 4 task §11): quantities accumulate per
 * (package, order item) - one package holds multiple SKUs and an order's
 * picked goods may be split across several packages.
 */
@Entity('package_items')
@Index('uq_package_items_package_order_item', ['packageId', 'orderItemId'], { unique: true })
@Index('idx_package_items_package', ['packageId'])
@Index('idx_package_items_order_item', ['orderItemId'])
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
