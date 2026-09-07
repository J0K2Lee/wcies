import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Reserved bundle structure (task §55/§56): a bundle SKU is composed of
 * component SKUs. Constraints enforced by the service: bundle != component,
 * quantity > 0, no recursive bundles (a component must not itself be a
 * bundle). UI intentionally not exposed in Sprint 1.
 */
@Entity('sku_bundle_components')
@Index('uq_bundle_component', ['bundleSkuId', 'componentSkuId'], { unique: true })
export class SkuBundleComponentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'bundle_sku_id' })
  bundleSkuId!: string;

  @Column({ type: 'uuid', name: 'component_sku_id' })
  componentSkuId!: string;

  @Column({ type: 'integer' })
  quantity!: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
