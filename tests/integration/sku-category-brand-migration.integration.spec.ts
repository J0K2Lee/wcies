import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { DataSource, QueryRunner } from 'typeorm';
import { SkuCategoryBrand1791883447000 } from '../../database/migrations/20261013_001_sku_category_brand';

/**
 * V1 改造阶段一 migration（20261013_001_sku_category_brand）真实 PG 验证：
 * 1. skus 增加 category_id / brand_id 列（FK 挂 categories / brands）与索引；
 * 2. 回填：每个 SKU 从原属 Product 单射继承分类/品牌（N:1，§89 无歧义）；
 * 3. product_id 可空（阶段二删表前置）；
 * 4. 全局 SKU 序列（决策 D2）：起点 = 现有 sku_code 数字后缀最大值 + 1；
 *    非数字后缀的存量编码 → up() 报错中止（防御分支）；
 * 5. 重复执行不炸（migration 幂等由 TypeORM migrations 表保证——本文件
 *    down + up 的流程本身即可反复执行）。
 *
 * 做法：直接驱动迁移类的 up()/down()（不经过 TypeORM 的 glob 动态加载——
 * vitest 的 SSR 动态导入不做 TS 类型导入擦除，typeorm 的 MigrationInterface
 * 等类型具名导入会在运行时炸 SyntaxError），先 down 回到 products 双层
 * 形态，插入「带品牌/分类的 product + 其下 SKU」fixture，再 up——回填与
 * 序列播种逻辑在 fixture 上真实执行一遍。文件按 vitest.config.integration.ts
 * 的 singleFork 顺序执行，期间无其他 spec 并发访问数据库。
 */
const MIGRATION_NAME = 'SkuCategoryBrand1791883447000';
const migration = new SkuCategoryBrand1791883447000();

// 本地 DataSource：只要连接与 QueryRunner，不配 migrations glob（避免上述
// 动态加载问题），也不配 entities（本测试只跑裸 SQL 与迁移类）。
const dataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  synchronize: false,
});

const BRAND_CODE = 'BNT001MIG';
const CATEGORY_L1 = 'CNT001MIGL1';
const CATEGORY_L2 = 'CNT001MIGL2';
const CATEGORY_L3 = 'CNT001MIGL3';
const PRODUCT_CODE = 'PNT001MIG';

let db: Client;
let runner: QueryRunner;
let fixtureSkuId = '';
let fixtureProductId = '';
let fixtureBrandId = '';
let fixtureCategoryL3Id = '';
let revertedByTest = false;

beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await dataSource.initialize();
  runner = dataSource.createQueryRunner();
  await runner.connect();
});

afterAll(async () => {
  // 清理 fixture（顺序：先 SKU 再 product；品牌/分类零引用后删）。
  if (fixtureSkuId !== '') {
    await db.query('DELETE FROM skus WHERE id = $1', [fixtureSkuId]);
  }
  if (fixtureProductId !== '') {
    await db.query('DELETE FROM products WHERE id = $1', [fixtureProductId]);
  }
  if (fixtureCategoryL3Id !== '') {
    await db.query('DELETE FROM categories WHERE id = $1', [fixtureCategoryL3Id]);
    await db.query('DELETE FROM categories WHERE code IN ($1, $2)', [CATEGORY_L1, CATEGORY_L2]);
  }
  if (fixtureBrandId !== '') {
    await db.query('DELETE FROM brands WHERE id = $1', [fixtureBrandId]);
  }
  // 安全网：若测试中途失败把 schema 留在 revert 态，这里补跑 up()，
  // 保证后续 spec 与 ensure-test-db 看到「migration 已应用」的形态。
  if (revertedByTest) {
    const columns = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM information_schema.columns
        WHERE table_name = 'skus' AND column_name IN ('category_id', 'brand_id')`,
    );
    if (Number(columns.rows[0]?.count ?? 0) < 2) {
      await migration.up(runner);
    }
  }
  await runner.release();
  await dataSource.destroy();
  await db.end();
});

/** 事务包裹，同 TypeORM 默认的 migrationTransactionMode='all'。 */
async function runInTransaction(fn: () => Promise<void>): Promise<void> {
  await runner.startTransaction();
  try {
    await fn();
    await runner.commitTransaction();
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  }
}

describe('migration 20261013_001: skus 加分类/品牌列 + 回填 + 全局序列', () => {
  it('down → fixture → up：回填单射继承 + 序列起点 = max+1 + 列可空 + 幂等', async () => {
    // 0) TypeORM migrations 表已记录本 migration（ensure-test-db 应用过），
    //    这是「重复执行不炸」的保证：runMigrations 不会二次应用。
    const recorded = await db.query<{ name: string }>(
      'SELECT name FROM migrations WHERE name = $1',
      [MIGRATION_NAME],
    );
    expect(recorded.rows[0]?.name).toBe(MIGRATION_NAME);

    // 1) down：回到 products 双层形态（同时删除 'sku' 序列行）。
    await runInTransaction(async () => {
      await migration.down(runner);
    });
    revertedByTest = true;

    const columnsAfterDown = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM information_schema.columns
        WHERE table_name = 'skus' AND column_name IN ('category_id', 'brand_id')`,
    );
    expect(Number(columnsAfterDown.rows[0]?.count ?? 0)).toBe(0);

    // 2) fixture：品牌 + 三级分类 + 挂两者的 product + 其下一个 SKU。
    const brand = await db.query<{ id: string }>(
      `INSERT INTO brands (code, name, name_zh, status)
       VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
      [BRAND_CODE, 'T1 迁移测试品牌', 'T1 迁移测试品牌'],
    );
    fixtureBrandId = brand.rows[0].id;
    const l1 = await db.query<{ id: string }>(
      `INSERT INTO categories (parent_id, code, name_zh, level, sort_order, status)
       VALUES (NULL, $1, $2, 1, 0, 'ACTIVE') RETURNING id`,
      [CATEGORY_L1, 'T1 迁移一级'],
    );
    const l2 = await db.query<{ id: string }>(
      `INSERT INTO categories (parent_id, code, name_zh, level, sort_order, status)
       VALUES ($1, $2, $3, 2, 0, 'ACTIVE') RETURNING id`,
      [l1.rows[0].id, CATEGORY_L2, 'T1 迁移二级'],
    );
    const l3 = await db.query<{ id: string }>(
      `INSERT INTO categories (parent_id, code, name_zh, level, sort_order, status)
       VALUES ($1, $2, $3, 3, 0, 'ACTIVE') RETURNING id`,
      [l2.rows[0].id, CATEGORY_L3, 'T1 迁移三级'],
    );
    fixtureCategoryL3Id = l3.rows[0].id;

    const product = await db.query<{ id: string }>(
      `INSERT INTO products (product_code, code_seq, name_zh, category_id, brand_id, status)
       VALUES ($1, (SELECT COALESCE(MAX(code_seq), 0) + 1 FROM products), $2, $3, $4, 'DRAFT')
       RETURNING id`,
      [PRODUCT_CODE, 'T1 迁移测试商品', fixtureCategoryL3Id, fixtureBrandId],
    );
    fixtureProductId = product.rows[0].id;

    // fixture SKU 编码取「当前最大数字后缀 + 1」，保证 ^SKU[0-9]+$ 且不撞号。
    const maxBefore = await db.query<{ m: string | null }>(
      `SELECT MAX(substring(sku_code from 4)::bigint)::text AS m
         FROM skus WHERE sku_code ~ '^SKU[0-9]+$'`,
    );
    const base = Number(maxBefore.rows[0]?.m ?? 0);
    const fixtureSkuCode = `SKU${String(base + 1).padStart(9, '0')}`;
    const sku = await db.query<{ id: string }>(
      `INSERT INTO skus (product_id, sku_code, name_zh, status)
       VALUES ($1, $2, 'T1 迁移测试 SKU', 'ACTIVE') RETURNING id`,
      [fixtureProductId, fixtureSkuCode],
    );
    fixtureSkuId = sku.rows[0].id;

    // 3) up：回填 + 序列播种在此 fixture 上真实执行。
    await runInTransaction(async () => {
      await migration.up(runner);
    });

    // 4) 回填：SKU 两列与原属 Product 一致（单射继承，D5）。
    const backfilled = await db.query<{ category_id: string | null; brand_id: string | null }>(
      'SELECT category_id, brand_id FROM skus WHERE id = $1',
      [fixtureSkuId],
    );
    expect(backfilled.rows[0]?.category_id).toBe(fixtureCategoryL3Id);
    expect(backfilled.rows[0]?.brand_id).toBe(fixtureBrandId);

    // 5) 序列起点 = fixture SKU 编码的数字后缀（即当时最大值）+ 1。
    const seq = await db.query<{ next_value: string }>(
      "SELECT next_value::text AS next_value FROM business_code_sequences WHERE scope_key = 'sku'",
    );
    expect(seq.rows[0]).toBeDefined();
    expect(Number(seq.rows[0].next_value)).toBe(base + 2);

    // 6) 列形态：FK 挂 categories/brands，索引在位，product_id 可空。
    const fkCategories = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pg_constraint
        WHERE conrelid = 'skus'::regclass AND contype = 'f'
          AND confrelid = 'categories'::regclass`,
    );
    expect(Number(fkCategories.rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
    const fkBrands = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pg_constraint
        WHERE conrelid = 'skus'::regclass AND contype = 'f'
          AND confrelid = 'brands'::regclass`,
    );
    expect(Number(fkBrands.rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);

    const indexes = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'skus'`,
    );
    const indexNames = indexes.rows.map((row) => row.indexname);
    expect(indexNames).toContain('idx_skus_category');
    expect(indexNames).toContain('idx_skus_brand');

    const productIdNullable = await db.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'skus' AND column_name = 'product_id'`,
    );
    expect(productIdNullable.rows[0]?.is_nullable).toBe('YES');

    // 7) 防御分支：非数字后缀的存量 sku_code 必须让 up() 报错中止。
    //    先再 down 一次（清掉列），事务外插入坏行，up 应在校验处抛出且
    //    事务整体回滚（列不留、序列不播种）。
    await runInTransaction(async () => {
      await migration.down(runner);
    });
    const badCode = `SKU-BAD${Date.now()}`;
    await db.query(
      `INSERT INTO skus (product_id, sku_code, name_zh, status)
       VALUES ($1, $2, 'T1 坏编码 SKU', 'ACTIVE')`,
      [fixtureProductId, badCode],
    );
    await expect(
      runInTransaction(async () => {
        await migration.up(runner);
      }),
    ).rejects.toThrow(/非纯数字后缀/);
    // 回滚后列不存在（证明 up 整体回滚，没有半拉子 schema）。
    const columnsAfterFailedUp = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM information_schema.columns
        WHERE table_name = 'skus' AND column_name IN ('category_id', 'brand_id')`,
    );
    expect(Number(columnsAfterFailedUp.rows[0]?.count ?? 0)).toBe(0);
    // 清掉坏行后重新 up，恢复「已应用」形态（afterAll 安全网之外的自恢复）。
    await db.query('DELETE FROM skus WHERE sku_code = $1', [badCode]);
    await runInTransaction(async () => {
      await migration.up(runner);
    });
    const restored = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM information_schema.columns
        WHERE table_name = 'skus' AND column_name IN ('category_id', 'brand_id')`,
    );
    expect(Number(restored.rows[0]?.count ?? 0)).toBe(2);
  });
});
