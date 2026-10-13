import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * V1 改造阶段二（任务 T9，决策 D1）：物理删除商品层。
 *
 * 前置条件（任务书明确）：T1–T8 全部合入且在 dev 环境手工验证通过；
 * **执行前须向用户确认**。
 *
 * 步骤：
 * 1. drop `fk_skus_product`（阶段一已把 `product_id` 置空，无写入依赖）；
 * 2. `DROP TABLE products`；
 * 3. drop 遗留序列 `seq_product_code`；
 * 4. 清理 `business_code_sequences` 死行：`product` 作用域与全部
 *    `sku:{productId}` 作用域（阶段一已播种全局 `sku`）。
 *
 * 不可逆（down 仅重建空表骨架，不恢复数据）——数据在阶段一已回填到
 * `skus.category_id` / `skus.brand_id`，商品行本身无独立业务价值。
 */
export class DropProducts1791883500000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) FK 先解（表被 drop 时其约束本会一并消失，显式删除以便审计可读）。
    await queryRunner.query(`ALTER TABLE skus DROP CONSTRAINT IF EXISTS fk_skus_product`);
    // 2) 序列依赖：seq_product_code 的 DEFAULT（若有）随表消失；无条件 drop。
    await queryRunner.query(`DROP TABLE IF EXISTS products`);
    // 3) 遗留序列（products.product_code 的历史取号来源，已无消费者）。
    await queryRunner.query(`DROP SEQUENCE IF EXISTS seq_product_code`);
    // 4) 死作用域清行：product 与 sku:{productId}（全局 'sku' 由阶段一播种）。
    const deleted = await queryRunner.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM business_code_sequences
        WHERE scope_key = 'product' OR scope_key LIKE 'sku:%'`,
    );
    const deadRows = Number(deleted[0]?.count ?? 0);
    await queryRunner.query(
      `DELETE FROM business_code_sequences WHERE scope_key = 'product' OR scope_key LIKE 'sku:%'`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `[migration] drop_products: products 表与 seq_product_code 已删除；` +
        `清理 ${deadRows} 条死作用域行（product / sku:{productId}）`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 安全舱：仅重建空表骨架与序列，不恢复数据（products 行无独立业务价值，
    // 分类/品牌已在阶段一回填到 skus）。列形状与 20260908_006 建表一致
    // （含 20260910_012 追加的 code_seq）。
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS products (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        product_code  varchar(100) NOT NULL,
        code_seq      integer,
        name_zh       varchar(500) NOT NULL,
        name_ru       varchar(500),
        category_id   uuid REFERENCES categories(id),
        brand_id      uuid REFERENCES brands(id),
        main_image_id uuid,
        status        varchar(30) NOT NULL DEFAULT 'DRAFT',
        remark        text,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        created_by    uuid,
        updated_by    uuid,
        CONSTRAINT uq_products_product_code UNIQUE (product_code)
      )
    `);
    await queryRunner.query(`CREATE SEQUENCE IF NOT EXISTS seq_product_code START 1`);
  }
}
