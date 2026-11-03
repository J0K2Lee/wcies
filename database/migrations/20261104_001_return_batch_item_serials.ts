import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 退货扫码入库（2026-11-04，用户确认「做！」）：
 *
 * SN 管理商品的退货必须在**逐件扫序列号**后才能入库（inventory 的
 * `receiveStockInTx` 要求每件一个 SN，数量与 SN 数必须一致）。批次行需要
 * 一个位置累积「到货时扫到的序列号」，扫满数量才真正写入库存。
 *
 * 非 SN 商品不使用该列（扫描一次整行入库）。
 */
export class ReturnBatchItemSerials1793900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE return_batch_items
        ADD COLUMN received_serial_numbers text[] NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE return_batch_items
        DROP COLUMN IF EXISTS received_serial_numbers
    `);
  }
}
