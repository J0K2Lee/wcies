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
import { PackageStatus } from '../enums/shipment.constants';
import { PackageItemEntity } from './package-item.entity';
import { ShipmentEntity } from './shipment.entity';

/**
 * Package (Sprint 4 task §10-§12): a physical box. One shipment packs N
 * packages; one package holds N SKUs. REPACK_REQUIRED marks a SEALED package
 * that lost a line to an interception and must be re-packed (task §44).
 */
@Entity('packages')
@Index('uq_packages_no', ['packageNo'], { unique: true })
@Index('idx_packages_shipment', ['shipmentId'])
@Index('idx_packages_status', ['status'])
export class PackageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 30, name: 'package_no' })
  packageNo!: string;

  @Column({ type: 'uuid', name: 'shipment_id' })
  shipmentId!: string;

  @Column({ type: 'varchar', length: 30, default: 'OPEN' })
  status!: PackageStatus;

  @Column({ type: 'varchar', length: 255, name: 'tracking_number', nullable: true })
  trackingNumber!: string | null;

  /** Reserved for per-package label linkage (task §10 field list). */
  @Column({ type: 'uuid', name: 'label_file_id', nullable: true })
  labelFileId!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 3, name: 'weight_kg', nullable: true })
  weightKg!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'length_cm', nullable: true })
  lengthCm!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'width_cm', nullable: true })
  widthCm!: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, name: 'height_cm', nullable: true })
  heightCm!: string | null;

  @Column({ type: 'timestamptz', name: 'sealed_at', nullable: true })
  sealedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => ShipmentEntity)
  @JoinColumn({ name: 'shipment_id' })
  shipment?: ShipmentEntity;

  @OneToMany(() => PackageItemEntity, (item) => item.package)
  items?: PackageItemEntity[];
}
