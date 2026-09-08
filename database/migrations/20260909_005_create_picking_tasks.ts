import { MigrationInterface, QueryRunner, Table, TableCheck, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

/**
 * Sprint 3: picking tasks HEADER (task §28/§30/§33).
 *
 * 1 PickingTask = 1 Warehouse - a task NEVER spans warehouses. The model is
 * not bound to "one order one task": items reference their own order lines.
 */
export class CreatePickingTasks1789002000005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SEQUENCE picking_task_no_seq START 1`);
    await queryRunner.createTable(
      new Table({
        name: 'picking_tasks',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'picking_no', type: 'varchar', length: 30, isNullable: false },
          { name: 'warehouse_id', type: 'uuid', isNullable: false },
          { name: 'status', type: 'varchar', length: 20, isNullable: false, default: `'CREATED'` },
          { name: 'created_by', type: 'uuid', isNullable: true },
          { name: 'created_by_name', type: 'varchar', length: 100, isNullable: true },
          { name: 'assigned_to', type: 'uuid', isNullable: true },
          { name: 'assigned_to_name', type: 'varchar', length: 100, isNullable: true },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'started_at', type: 'timestamptz', isNullable: true },
          { name: 'completed_at', type: 'timestamptz', isNullable: true },
        ],
        uniques: [new TableUnique({ name: 'uq_picking_tasks_no', columnNames: ['picking_no'] })],
        indices: [
          new TableIndex({ name: 'idx_picking_tasks_warehouse', columnNames: ['warehouse_id'] }),
          new TableIndex({ name: 'idx_picking_tasks_status', columnNames: ['status'] }),
        ],
        checks: [
          new TableCheck({
            name: 'ck_picking_tasks_status',
            expression: "status IN ('CREATED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')",
          }),
        ],
        foreignKeys: [
          {
            name: 'fk_picking_tasks_warehouse',
            columnNames: ['warehouse_id'],
            referencedTableName: 'warehouses',
            referencedColumnNames: ['id'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('picking_tasks');
    await queryRunner.query(`DROP SEQUENCE IF EXISTS picking_task_no_seq`);
  }
}
