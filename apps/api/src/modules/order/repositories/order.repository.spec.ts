import { describe, expect, it, vi } from 'vitest';
import { DataSource, EntityManager } from 'typeorm';
import { OrderEntity } from '../entities/order.entity';
import { OrderRepository, orderSortOf } from './order.repository';

describe('OrderRepository.updatePlatformFacts - fulfillmentMode', () => {
  function build() {
    const update = vi.fn().mockResolvedValue(undefined);
    const getRepository = vi.fn().mockReturnValue({ update });
    const manager = { getRepository } as unknown as EntityManager;
    const repository = new OrderRepository({} as DataSource);
    return { repository, manager, update, getRepository };
  }

  const basePatch = {
    platformStatus: 'awaiting_packaging',
    shipmentDeadline: null,
    rawData: null,
  };

  it.each(['RFBS', 'FBP', 'FBS', 'hybrid'])(
    'passes %s to the actual TypeORM update boundary',
    async (fulfillmentMode) => {
      const { repository, manager, update, getRepository } = build();
      await repository.updatePlatformFacts(manager, 'order-1', { ...basePatch, fulfillmentMode });

      expect(getRepository).toHaveBeenCalledWith(OrderEntity);
      expect(update).toHaveBeenCalledExactlyOnceWith(
        { id: 'order-1' },
        { ...basePatch, fulfillmentMode, updatedAt: expect.any(Date) },
      );
    },
  );

  it.each([undefined, null])(
    'omits %s from UPDATE rather than clearing the stored channel',
    async (fulfillmentMode) => {
      const { repository, manager, update } = build();
      await repository.updatePlatformFacts(manager, 'order-1', { ...basePatch, fulfillmentMode });

      expect(update).toHaveBeenCalledExactlyOnceWith(
        { id: 'order-1' },
        { ...basePatch, updatedAt: expect.any(Date) },
      );
      expect(update.mock.calls[0]?.[1]).not.toHaveProperty('fulfillmentMode');
    },
  );
});

describe('orderSortOf (2026-10-14 列表排序白名单)', () => {
  it('maps skuCode to the MIN(sku_code) key with NULLS LAST and orderedAt tiebreaker', () => {
    expect(orderSortOf('skuCode', 'asc')).toEqual([
      {
        expression:
          '(SELECT MIN(sk.sku_code) FROM order_items i LEFT JOIN skus sk ON sk.id = i.sku_id WHERE i.order_id = o.id)',
        direction: 'ASC',
        nulls: 'NULLS LAST',
      },
      { expression: 'o.orderedAt', direction: 'DESC' },
    ]);
    expect(orderSortOf('skuCode', 'desc')[0]).toMatchObject({ direction: 'DESC' });
  });

  it('maps shipmentDeadline with NULLS LAST in both directions', () => {
    expect(orderSortOf('shipmentDeadline', 'asc')[0]).toMatchObject({
      expression: 'o.shipmentDeadline',
      direction: 'ASC',
      nulls: 'NULLS LAST',
    });
    expect(orderSortOf('shipmentDeadline', 'desc')[0]).toMatchObject({
      direction: 'DESC',
      nulls: 'NULLS LAST',
    });
  });

  it('defaults to orderedAt (id tiebreaker) for undefined sortBy', () => {
    expect(orderSortOf(undefined, undefined)).toEqual([
      { expression: 'o.orderedAt', direction: 'DESC' },
      { expression: 'o.id', direction: 'ASC' },
    ]);
  });
});
