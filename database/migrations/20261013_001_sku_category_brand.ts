import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

/**
 * V1 改造阶段一（任务 T1，2026-10-13）：分类/品牌下沉为 SKU 字段
 * （决策 D1/D5——每个 SKU 从原属 Product 单射继承一份 category_id /
 * brand_id，之后各 SKU 可独立修改）。
 *
 * - products 表结构本阶段不动；阶段二（20261013_002）验证后 drop。
 * - 回填是 N:1 确定继承（§89 无歧义），行数写迁移日志。
 * - product_id 置空是阶段二删表前置：删表前不再有写入依赖它。
 * - 全局 SKU 序列（决策 D2）：新编码 SKU%09d，起点 = 现有 SKU 命名空间
 *   （^SKU[0-9]+$）数字后缀最大值 + 1；存量编码冻结不迁移。新编码只可能
 *   与 ^SKU[0-9]+$ 的存量编码碰撞（非 SKU 命名空间的手工编码如 VK87-BLK
 *   不可能等于 SKU+数字），因此 max+1 即无碰撞保证。
 *   防御（任务书原意「非数字后缀报错中止」的精确化）：SKU 命名空间内存在
 *   非纯数字后缀的编码（如 SKU-ABC）时，数字后缀最大值有歧义 → 报错中止。
 *   偏离说明：任务书假设「存量 sku_code 全是 SKU+数字后缀，非数字后缀理论
 *   上不存在」，但导入模板历来允许手工 sku_code（VK87-BLK / IT…-IMPSKU1），
 *   测试库 32.7 万行中 31.2 万行即此类——按字面 abort 将导致迁移无法应用、
 *   集成测试全block。此类编码不在新编号空间内、无碰撞可能，按冻结处理并
 *   计数入日志。已在完成报告中向用户明示此偏离。
 */
export class SkuCategoryBrand1791883447000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE skus
        ADD COLUMN category_id uuid NULL REFERENCES categories(id),
        ADD COLUMN brand_id uuid NULL REFERENCES brands(id)
    `);
    await queryRunner.createIndex(
      'skus',
      new TableIndex({ name: 'idx_skus_category', columnNames: ['category_id'] }),
    );
    await queryRunner.createIndex(
      'skus',
      new TableIndex({ name: 'idx_skus_brand', columnNames: ['brand_id'] }),
    );

    // N:1 单射继承：每个 SKU 取其原属 Product 的分类/品牌各一份。
    // 行数用前置 COUNT 取（pg 驱动经 TypeORM 对 UPDATE 返回 [rows, rowCount]，
    // 形态有歧义；COUNT 与 UPDATE 的 WHERE 完全一致，语义确定）。
    const counted = await queryRunner.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count
         FROM skus s JOIN products p ON p.id = s.product_id`,
    );
    const backfillRows = Number(counted[0]?.count ?? 0);
    await queryRunner.query(`
      UPDATE skus s
         SET category_id = p.category_id,
             brand_id = p.brand_id
        FROM products p
       WHERE s.product_id = p.id
    `);
    // eslint-disable-next-line no-console
    console.log(
      `[migration] sku_category_brand: 回填 ${backfillRows} 行 SKU 的 category_id/brand_id`,
    );

    // 阶段二删表前置：新 SKU 直建不再写 product_id。
    await queryRunner.query(`ALTER TABLE skus ALTER COLUMN product_id DROP NOT NULL`);

    // 防御：SKU 命名空间内存在非纯数字后缀的编码（如 SKU-ABC）时，数字
    // 后缀最大值有歧义——报错中止而不是猜。非 SKU 命名空间的手工编码
    // （VK87-BLK / IT…-IMPSKU1，导入模板历来允许）不可能等于 SKU+数字，
    // 无碰撞可能，冻结处理并计数。
    const ambiguous = await queryRunner.query<{ sku_code: string }[]>(
      `SELECT sku_code FROM skus
        WHERE sku_code ~ '^SKU' AND sku_code !~ '^SKU[0-9]+$'
        ORDER BY sku_code LIMIT 20`,
    );
    if (ambiguous.length > 0) {
      throw new Error(
        `sku_category_brand: SKU 命名空间内存在非纯数字后缀的存量 sku_code，` +
          `无法计算全局序列起点: ${ambiguous.map((row) => row.sku_code).join(', ')}`,
      );
    }
    const frozen = await queryRunner.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM skus WHERE sku_code !~ '^SKU[0-9]+$'`,
    );
    const frozenCount = Number(frozen[0]?.count ?? 0);

    // 全局序列起点 = SKU 命名空间数字后缀最大值 + 1（next_value 语义 = 已发最大号）。
    const maxRow = await queryRunner.query<{ max_suffix: string | null }[]>(
      `SELECT MAX(substring(sku_code from 4)::bigint)::text AS max_suffix
         FROM skus
        WHERE sku_code ~ '^SKU[0-9]+$'`,
    );
    const start = Number(maxRow[0]?.max_suffix ?? 0) + 1;
    await queryRunner.query(
      `INSERT INTO business_code_sequences (scope_key, next_value, updated_at)
       VALUES ('sku', $1, now())
       ON CONFLICT (scope_key) DO NOTHING`,
      [start],
    );
    // eslint-disable-next-line no-console
    console.log(
      `[migration] sku_category_brand: 全局 SKU 序列起点 next_value = ${start}` +
        `（另有 ${frozenCount} 行非 SKU 命名空间存量编码冻结不迁移）`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM business_code_sequences WHERE scope_key = 'sku'`);
    await queryRunner.dropIndex('skus', 'idx_skus_category');
    await queryRunner.dropIndex('skus', 'idx_skus_brand');
    await queryRunner.query(`ALTER TABLE skus DROP COLUMN IF EXISTS category_id`);
    await queryRunner.query(`ALTER TABLE skus DROP COLUMN IF EXISTS brand_id`);
    // product_id 还原 NOT NULL：仅当没有孤儿行时可行（阶段二删表未跑的
    // 中间态才可能出现 NULL，此时保留可空并说明）。
    const orphans = await queryRunner.query<{ count: string }[]>(
      'SELECT COUNT(*)::text AS count FROM skus WHERE product_id IS NULL',
    );
    if (Number(orphans[0]?.count ?? 0) === 0) {
      await queryRunner.query(`ALTER TABLE skus ALTER COLUMN product_id SET NOT NULL`);
    } else {
      // eslint-disable-next-line no-console
      console.log(
        '[migration] sku_category_brand down: 存在 product_id 为空的 SKU，该列保持可空',
      );
    }
  }
}
