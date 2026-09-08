import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PickingTaskEntity } from '../entities/picking-task.entity';
import { rawStr } from '../../../common/utils/raw';

export interface PickingTaskListFilters {
  warehouseId?: string;
  status?: string;
  orderId?: string;
}

/** Data access for picking-task headers. */
@Injectable()
export class PickingTaskRepository {
  constructor(private readonly dataSource: DataSource) {}

  async nextPickingNo(manager: EntityManager): Promise<string> {
    const result = await manager.query<Array<{ no: string }>>(
      `SELECT nextval('picking_task_no_seq') AS no`,
    );
    return `PCK${result[0]!.no.padStart(8, '0')}`;
  }

  async insert(
    manager: EntityManager,
    row: {
      pickingNo: string;
      warehouseId: string;
      createdBy: string | null;
      createdByName: string | null;
    },
  ): Promise<PickingTaskEntity> {
    const repository = manager.getRepository(PickingTaskEntity);
    return repository.save(repository.create({ ...row, status: 'CREATED' }));
  }

  async findById(id: string): Promise<PickingTaskEntity | null> {
    return this.dataSource.getRepository(PickingTaskEntity).findOneBy({ id });
  }

  async updateStatus(
    manager: EntityManager,
    id: string,
    patch: Partial<
      Pick<
        PickingTaskEntity,
        'status' | 'startedAt' | 'completedAt' | 'assignedTo' | 'assignedToName'
      >
    >,
  ): Promise<void> {
    await manager
      .getRepository(PickingTaskEntity)
      .update({ id }, { ...patch, updatedAt: new Date() });
  }

  /** List with warehouse refs + per-task item aggregates (no N+1). */
  async listWithAggregates(
    filters: PickingTaskListFilters,
    limit: number,
    offset: number,
  ): Promise<{
    rows: Array<{
      task: PickingTaskEntity;
      warehouseCode: string;
      warehouseName: string;
      ordersCount: number;
      itemsTotal: number;
      itemsPicked: number;
      requiredTotal: string;
      pickedTotal: string;
    }>;
    total: number;
  }> {
    const qb = this.dataSource
      .getRepository(PickingTaskEntity)
      .createQueryBuilder('t')
      .innerJoin('warehouses', 'wh', 'wh.id = t.warehouse_id')
      .addSelect('wh.warehouse_code', 'warehouse_code')
      .addSelect('wh.name', 'warehouse_name')
      .addSelect(
        `(SELECT COUNT(DISTINCT i.order_id) FROM picking_task_items i WHERE i.picking_task_id = t.id)`,
        'orders_count',
      )
      .addSelect(
        `(SELECT COUNT(*) FROM picking_task_items i WHERE i.picking_task_id = t.id)`,
        'items_total',
      )
      .addSelect(
        `(SELECT COUNT(*) FROM picking_task_items i WHERE i.picking_task_id = t.id AND i.status = 'PICKED')`,
        'items_picked',
      )
      .addSelect(
        `(SELECT COALESCE(SUM(i.required_qty), 0) FROM picking_task_items i WHERE i.picking_task_id = t.id)`,
        'required_total',
      )
      .addSelect(
        `(SELECT COALESCE(SUM(i.picked_qty), 0) FROM picking_task_items i WHERE i.picking_task_id = t.id)`,
        'picked_total',
      );
    if (filters.warehouseId !== undefined) {
      qb.andWhere('t.warehouse_id = :warehouseId', { warehouseId: filters.warehouseId });
    }
    if (filters.status !== undefined) {
      qb.andWhere('t.status = :status', { status: filters.status });
    }
    if (filters.orderId !== undefined) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM picking_task_items i WHERE i.picking_task_id = t.id AND i.order_id = :orderId)`,
        { orderId: filters.orderId },
      );
    }
    qb.orderBy('t.createdAt', 'DESC').skip(offset).take(limit);
    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<Record<string, unknown>>;
    return {
      rows: entities.map((task, index) => ({
        task,
        warehouseCode: rawStr(rawList[index]?.['warehouse_code']),
        warehouseName: rawStr(rawList[index]?.['warehouse_name']),
        ordersCount: Number(rawList[index]?.['orders_count'] ?? 0),
        itemsTotal: Number(rawList[index]?.['items_total'] ?? 0),
        itemsPicked: Number(rawList[index]?.['items_picked'] ?? 0),
        requiredTotal: rawStr(rawList[index]?.['required_total']),
        pickedTotal: rawStr(rawList[index]?.['picked_total']),
      })),
      total,
    };
  }
}
