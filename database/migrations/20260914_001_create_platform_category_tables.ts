import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Sprint 8.5 (planning §7): two new tables for the platform category system.
 *
 * - platform_category_nodes: bilingual cache of the OZON description-category
 *   tree (integration reference data, refreshed by manual tree sync).
 *   T0 smoke fact (2026-09-14): the real tree is exactly 3 levels -
 *   L1/L2 categories + L3 type entries; type nodes do NOT carry
 *   description_category_id, so TYPE rows store the PARENT category id in
 *   external_category_id (composite key intact).
 * - platform_category_mappings: (platform, external_category_id,
 *   external_type_id) -> internal_category_id, written by the tree import
 *   (TREE_IMPORT) and by "remember this mapping" during onboarding (ONBOARD).
 *
 * The sync_jobs sync_type CHECK also gains the two Sprint 8.5 types
 * (CATEGORY_TREE_SYNC, PRODUCT_ENRICHMENT_SYNC) - both are store-scoped and
 * recorded like every other sync (AGENTS.md §43/§44).
 */
export class CreatePlatformCategoryTables1790000001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'platform_category_nodes',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'platform_id', type: 'uuid', isNullable: false },
          { name: 'node_kind', type: 'varchar', length: 20, isNullable: false },
          {
            // CATEGORY rows: the node's own category id.
            // TYPE rows: the PARENT category id (type nodes carry no own id).
            name: 'external_category_id',
            type: 'bigint',
            isNullable: false,
          },
          { name: 'external_type_id', type: 'bigint', isNullable: true },
          {
            // External parent reference (bigint) instead of a uuid FK: the
            // tree is fully rewritten per sync, so an external key keeps
            // upserts order-free and parentless-safe.
            name: 'parent_node_external_id',
            type: 'bigint',
            isNullable: true,
          },
          { name: 'name_zh', type: 'varchar', length: 500, isNullable: false },
          { name: 'name_ru', type: 'varchar', length: 500, isNullable: true },
          { name: 'level', type: 'smallint', isNullable: false },
          { name: 'disabled', type: 'boolean', isNullable: false, default: 'false' },
          { name: 'fetched_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        foreignKeys: [
          {
            name: 'fk_pcn_platform',
            columnNames: ['platform_id'],
            referencedTableName: 'platforms',
            referencedColumnNames: ['id'],
          },
        ],
        checks: [
          {
            name: 'ck_pcn_node_kind',
            expression: `node_kind IN ('CATEGORY', 'TYPE')`,
          },
          {
            name: 'ck_pcn_level',
            expression: `level BETWEEN 1 AND 3`,
          },
          {
            name: 'ck_pcn_type_shape',
            expression: `(node_kind = 'CATEGORY' AND external_type_id IS NULL) OR (node_kind = 'TYPE' AND external_type_id IS NOT NULL)`,
          },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'platform_category_nodes',
      new TableIndex({
        name: 'idx_pcn_platform_level',
        columnNames: ['platform_id', 'level'],
      }),
    );
    await queryRunner.createIndex(
      'platform_category_nodes',
      new TableIndex({
        name: 'idx_pcn_parent',
        columnNames: ['parent_node_external_id'],
      }),
    );
    // Dedup key. Raw SQL: expression UNIQUE index (TypeORM TableIndex cannot
    // express COALESCE), and NULLS NOT DISTINCT needs the same care as the
    // partial indexes (Sprint 5 pitfall) - COALESCE avoids both problems.
    await queryRunner.query(
      `CREATE UNIQUE INDEX uq_pcn_external_key
         ON platform_category_nodes (platform_id, external_category_id, COALESCE(external_type_id, -1))`,
    );

    await queryRunner.createTable(
      new Table({
        name: 'platform_category_mappings',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'platform_id', type: 'uuid', isNullable: false },
          { name: 'external_category_id', type: 'bigint', isNullable: false },
          { name: 'external_type_id', type: 'bigint', isNullable: false },
          { name: 'internal_category_id', type: 'uuid', isNullable: false },
          {
            name: 'source',
            type: 'varchar',
            length: 30,
            isNullable: false,
            default: "'ONBOARD'",
          },
          { name: 'created_by', type: 'uuid', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        foreignKeys: [
          {
            name: 'fk_pcm_platform',
            columnNames: ['platform_id'],
            referencedTableName: 'platforms',
            referencedColumnNames: ['id'],
          },
          {
            name: 'fk_pcm_internal_category',
            columnNames: ['internal_category_id'],
            referencedTableName: 'categories',
            referencedColumnNames: ['id'],
          },
        ],
        checks: [
          {
            name: 'ck_pcm_source',
            expression: `source IN ('TREE_IMPORT', 'ONBOARD')`,
          },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'platform_category_mappings',
      new TableIndex({
        name: 'uq_pcm_external_key',
        columnNames: ['platform_id', 'external_category_id', 'external_type_id'],
        isUnique: true,
      }),
    );
    await queryRunner.createIndex(
      'platform_category_mappings',
      new TableIndex({
        name: 'idx_pcm_internal_category',
        columnNames: ['internal_category_id'],
      }),
    );

    await queryRunner.query(
      `ALTER TABLE sync_jobs DROP CONSTRAINT ck_sync_jobs_sync_type`,
    );
    await queryRunner.query(
      `ALTER TABLE sync_jobs ADD CONSTRAINT ck_sync_jobs_sync_type
         CHECK (sync_type IN ('LISTING_SYNC', 'ORDER_SYNC', 'CATEGORY_TREE_SYNC', 'PRODUCT_ENRICHMENT_SYNC'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE sync_jobs DROP CONSTRAINT ck_sync_jobs_sync_type`,
    );
    await queryRunner.query(
      `ALTER TABLE sync_jobs ADD CONSTRAINT ck_sync_jobs_sync_type
         CHECK (sync_type IN ('LISTING_SYNC', 'ORDER_SYNC'))`,
    );
    await queryRunner.dropTable('platform_category_mappings', true);
    await queryRunner.dropTable('platform_category_nodes', true);
  }
}
