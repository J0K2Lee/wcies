import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderItemPlatformImage1791600004000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE order_items ADD COLUMN platform_image_url text NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE order_items DROP COLUMN platform_image_url');
  }
}
