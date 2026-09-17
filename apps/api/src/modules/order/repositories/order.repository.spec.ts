import { describe, expect, it, vi } from 'vitest';
import { DataSource, EntityManager } from 'typeorm';
import { OrderEntity } from '../entities/order.entity';
import { OrderRepository } from './order.repository';

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
