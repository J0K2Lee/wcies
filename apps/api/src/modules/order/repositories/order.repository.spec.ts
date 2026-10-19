import { describe, expect, it, vi } from 'vitest';
import { DataSource, EntityManager } from 'typeorm';
import { OrderEntity } from '../entities/order.entity';
import { OrderRepository, orderBySqlOf, orderSortOf } from './order.repository';

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

describe('orderSortOf (2026-10-14 列表排序白名单；2026-10-16 加急置顶)', () => {
  it('恒以 isUrgent DESC 为首级键（无论所选排序）', () => {
    expect(orderSortOf('skuCode', 'asc')[0]).toEqual({
      expression: 'o.isUrgent',
      direction: 'DESC',
    });
    expect(orderSortOf('shipmentDeadline', 'asc')[0]).toEqual({
      expression: 'o.isUrgent',
      direction: 'DESC',
    });
    expect(orderSortOf(undefined, undefined)[0]).toEqual({
      expression: 'o.isUrgent',
      direction: 'DESC',
    });
  });

  it('maps skuCode to the selected first_sku_code alias with NULLS LAST and orderedAt tiebreaker', () => {
    // 必须用 SELECT 别名而非 MIN 子查询原文：分页走 skip/take + joins 时
    // TypeORM 按 alias.property 解析 ORDER BY，含点的子查询会抛
    // "(SELECT MIN(sk" alias was not found（2026-10-17 bug）。
    expect(orderSortOf('skuCode', 'asc')).toEqual([
      { expression: 'o.isUrgent', direction: 'DESC' },
      { expression: 'first_sku_code', direction: 'ASC', nulls: 'NULLS LAST' },
      { expression: 'o.orderedAt', direction: 'DESC' },
    ]);
    expect(orderSortOf('skuCode', 'desc')[1]).toMatchObject({ direction: 'DESC' });
  });

  it('maps shipmentDeadline with NULLS LAST in both directions', () => {
    expect(orderSortOf('shipmentDeadline', 'asc')[1]).toMatchObject({
      expression: 'o.shipmentDeadline',
      direction: 'ASC',
      nulls: 'NULLS LAST',
    });
    expect(orderSortOf('shipmentDeadline', 'desc')[1]).toMatchObject({
      direction: 'DESC',
      nulls: 'NULLS LAST',
    });
  });

  it('defaults to orderedAt (id tiebreaker) for undefined sortBy', () => {
    expect(orderSortOf(undefined, undefined)).toEqual([
      { expression: 'o.isUrgent', direction: 'DESC' },
      { expression: 'o.orderedAt', direction: 'DESC' },
      { expression: 'o.id', direction: 'ASC' },
    ]);
  });
});

describe('orderBySqlOf (2026-10-19 批量打印面单：装订顺序与列表一致)', () => {
  it('默认按下单时间，且加急恒定置顶', () => {
    expect(orderBySqlOf(undefined, undefined)).toBe(
      'o.is_urgent DESC, o.ordered_at DESC, o.id ASC',
    );
    expect(orderBySqlOf('orderedAt', 'asc')).toBe('o.is_urgent DESC, o.ordered_at ASC, o.id ASC');
  });

  it('SKU / 发货时限键用子查询原文 + NULLS LAST（与 orderSortOf 同语义）', () => {
    const sku = orderBySqlOf('skuCode', 'asc');
    expect(sku.startsWith('o.is_urgent DESC, (SELECT MIN(sk.sku_code)')).toBe(true);
    expect(sku).toContain('ASC NULLS LAST, o.ordered_at DESC, o.id ASC');

    const deadline = orderBySqlOf('shipmentDeadline', 'asc');
    expect(deadline).toBe(
      'o.is_urgent DESC, o.shipment_deadline ASC NULLS LAST, o.ordered_at DESC, o.id ASC',
    );
  });
});
