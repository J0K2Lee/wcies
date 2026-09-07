import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Warehouse bin / storage location (task §38-§40).
 * Unique per (warehouse_id, bin_code); different warehouses may share codes.
 * NO sku_id column: SKU <-> Bin is N:M through inventory records in a later
 * sprint (task §39).
 */
@Entity('warehouse_bins')
@Index('uq_warehouse_bins_wh_code', ['warehouseId', 'binCode'], { unique: true })
export class WarehouseBinEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'warehouse_id' })
  warehouseId!: string;

  @Column({ type: 'varchar', length: 100, name: 'bin_code' })
  binCode!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  zone!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  rack!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  level!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  position!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  barcode!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
