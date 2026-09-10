import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Category tree, max 3 levels (Sprint 6 decision 0005); no platform mapping. */
@Entity('categories')
@Index('idx_categories_parent', ['parentId'])
export class CategoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'parent_id', nullable: true })
  parentId!: string | null;

  @Column({ type: 'varchar', length: 100, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 200, name: 'name_zh' })
  nameZh!: string;

  @Column({ type: 'varchar', length: 200, name: 'name_ru', nullable: true })
  nameRu!: string | null;

  /** 1..3, DB CHECK-enforced; (level = 1) <=> (parent_id IS NULL). */
  @Column({ type: 'smallint' })
  level!: number;

  @Column({ type: 'integer', name: 'sort_order', default: 0 })
  sortOrder!: number;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
