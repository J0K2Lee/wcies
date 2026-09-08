import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableUnique } from 'typeorm';

/**
 * Sprint 2: inventory EVENTS - the parent of the transaction ledger
 * (task §17-§18, adopted Event + Lines model).
 *
 * One business action = one event = one idempotency key. Multi-row actions
 * (moveBin: Bin A -N / Bin B +N) are two transaction lines under a single
 * event, which keeps audits grouped and idempotency unambiguous.
 */
export class CreateInventoryEvents1789000800021 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SEQUENCE inventory_event_no_seq START 1`);
    await queryRunner.createTable(
      new Table({
        name: 'inventory_events',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'event_no', type: 'varchar', length: 30, isNullable: false },
          { name: 'event_type', type: 'varchar', length: 40, isNullable: false },
          { name: 'reference_type', type: 'varchar', length: 30, isNullable: false },
          { name: 'reference_id', type: 'uuid', isNullable: false },
          { name: 'idempotency_key', type: 'varchar', length: 200, isNullable: false },
          { name: 'operator_id', type: 'uuid', isNullable: true },
          { name: 'remark', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [
          new TableUnique({ name: 'uq_inventory_events_no', columnNames: ['event_no'] }),
          new TableUnique({ name: 'uq_inventory_events_idem', columnNames: ['idempotency_key'] }),
        ],
        foreignKeys: [
          {
            name: 'fk_inventory_events_operator',
            columnNames: ['operator_id'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('inventory_events');
    await queryRunner.query(`DROP SEQUENCE IF EXISTS inventory_event_no_seq`);
  }
}
