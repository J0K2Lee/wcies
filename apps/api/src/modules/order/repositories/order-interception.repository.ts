import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrderInterceptionEntity } from '../entities/order-interception.entity';

/** Sprint 3 creates interceptions only; the workflow is a later sprint (task §57). */
@Injectable()
export class OrderInterceptionRepository {
  constructor(private readonly dataSource: DataSource) {}

  async nextInterceptionNo(manager: EntityManager): Promise<string> {
    const result = await manager.query<Array<{ no: string }>>(
      `SELECT nextval('order_interception_no_seq') AS no`,
    );
    return `ITC${result[0]!.no.padStart(8, '0')}`;
  }

  async insert(
    manager: EntityManager,
    row: {
      interceptionNo: string;
      orderId: string;
      orderItemId: string | null;
      warehouseId: string;
      reason: string | null;
    },
  ): Promise<OrderInterceptionEntity> {
    const repository = manager.getRepository(OrderInterceptionEntity);
    return repository.save(repository.create({ ...row, status: 'CREATED' }));
  }

  async listByOrderId(orderId: string): Promise<OrderInterceptionEntity[]> {
    return this.dataSource
      .getRepository(OrderInterceptionEntity)
      .find({ where: { orderId }, order: { createdAt: 'ASC' } });
  }
}
