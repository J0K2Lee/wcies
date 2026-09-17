import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

/**
 * 内部仓库 → 平台仓库绑定（用户指示 2026-09-17，取代店仓绑定）。
 *
 * 绑定主体是【物理仓库 + 平台仓库】；平台仓库归属具体店铺（platform
 * warehouse 永远是某个 store 下的概念），因此同一物理仓库可通过多条绑定
 * 服务多个店铺。履约模式来自平台侧仓库分类（OZON rFBS/FBS/FBP/FBO），
 * 与仓库类型的兼容校验在服务层完成（AGENTS.md §31）。
 */
@Entity('warehouse_platform_bindings')
@Unique('uq_wpb_store_platform_wh', ['storeId', 'platformWarehouseId'])
@Index('idx_wpb_warehouse', ['warehouseId'])
export class WarehousePlatformBindingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'warehouse_id' })
  warehouseId!: string;

  @Column({ type: 'uuid', name: 'store_id' })
  storeId!: string;

  /** 平台仓库 ID（如 OZON warehouse_id 1020005000770362），平台内数字/字符串原样保存。 */
  @Column({ type: 'varchar', length: 64, name: 'platform_warehouse_id' })
  platformWarehouseId!: string;

  /** 绑定时平台返回的仓库名称快照（展示用，平台可改名）。 */
  @Column({ type: 'varchar', length: 255, name: 'platform_warehouse_name', nullable: true })
  platformWarehouseName!: string | null;

  @Column({ type: 'varchar', length: 50, name: 'fulfillment_mode' })
  fulfillmentMode!: string;

  /** 操作者输入的备注名（用户指示：绑定弹窗支持输入备注名）。 */
  @Column({ type: 'varchar', length: 255, name: 'remark_name', nullable: true })
  remarkName!: string | null;

  @Column({ type: 'integer', default: 100 })
  priority!: number;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
