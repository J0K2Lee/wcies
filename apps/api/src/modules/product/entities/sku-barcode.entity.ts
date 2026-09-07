import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Barcode of an internal SKU (task §28-§32). `barcode` is globally unique -
 * one barcode can never point at two SKUs. At most one primary per SKU is
 * enforced by the partial unique index uq_sku_barcodes_one_primary.
 * 69-codes fall under EAN/GTIN semantics; no CN_69_CODE type exists.
 */
@Entity('sku_barcodes')
@Index('uq_sku_barcodes_barcode', ['barcode'], { unique: true })
@Index('idx_sku_barcodes_sku', ['skuId'])
export class SkuBarcodeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'sku_id' })
  skuId!: string;

  @Column({ type: 'varchar', length: 255 })
  barcode!: string;

  @Column({ type: 'varchar', length: 30, name: 'barcode_type' })
  barcodeType!: string;

  @Column({ type: 'boolean', name: 'is_primary', default: false })
  isPrimary!: boolean;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}

export { BARCODE_TYPES, BarcodeType } from '../constants/barcode.constants';
