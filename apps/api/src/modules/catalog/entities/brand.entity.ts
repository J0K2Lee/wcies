import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Product brand master data (e.g. VALKYRIE, iKF) - task §13; Sprint 6 decision 0006. */
@Entity('brands')
export class BrandEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  code!: string;

  /** General name: required, the default display name everywhere. */
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 200, name: 'name_zh', nullable: true })
  nameZh!: string | null;

  @Column({ type: 'varchar', length: 200, name: 'name_en', nullable: true })
  nameEn!: string | null;

  @Column({ type: 'varchar', length: 200, name: 'name_ru', nullable: true })
  nameRu!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
