import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PackageEntity } from './package.entity';
import { ShipmentEntity } from './shipment.entity';
import { ShippingLabelSource, ShippingLabelType } from '../enums/shipment.constants';

/**
 * Shipping label (Sprint 4 task §19-§20): platform-agnostic metadata pointing
 * at a PRIVATE object-storage file (ObjectStorageService only - never an S3
 * SDK in business code). Sprint 4 creates MANUAL_UPLOAD rows; real platform
 * label fetch belongs to the platform-integration sprint.
 */
@Entity('shipping_labels')
@Index('idx_shipping_labels_shipment', ['shipmentId'])
@Index('idx_shipping_labels_package', ['packageId'])
export class ShippingLabelEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'shipment_id' })
  shipmentId!: string;

  @Column({ type: 'uuid', name: 'package_id', nullable: true })
  packageId!: string | null;

  @Column({ type: 'varchar', length: 30, name: 'label_type', default: 'SHIPPING' })
  labelType!: ShippingLabelType;

  @Column({ type: 'varchar', length: 500, name: 'object_key' })
  objectKey!: string;

  @Column({ type: 'varchar', length: 255, name: 'file_name' })
  fileName!: string;

  @Column({ type: 'varchar', length: 100, name: 'mime_type' })
  mimeType!: string;

  @Column({ type: 'integer', name: 'file_size' })
  fileSize!: number;

  @Column({ type: 'varchar', length: 30, default: 'MANUAL_UPLOAD' })
  source!: ShippingLabelSource;

  @Column({ type: 'varchar', length: 255, name: 'external_label_id', nullable: true })
  externalLabelId!: string | null;

  @Column({ type: 'uuid', name: 'uploaded_by', nullable: true })
  uploadedBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => ShipmentEntity)
  @JoinColumn({ name: 'shipment_id' })
  shipment?: ShipmentEntity;

  @ManyToOne(() => PackageEntity)
  @JoinColumn({ name: 'package_id' })
  package?: PackageEntity;
}
