import { DomainError } from '../../../common/errors/domain.error';

/** Stock cannot cover the requested quantity (task §28). */
export class InsufficientStockError extends DomainError {
  readonly code = 'INVENTORY_INSUFFICIENT_STOCK';
  readonly httpStatus = 409;

  constructor(details: {
    skuId: string;
    warehouseId: string;
    requestedQty: string;
    availableQty?: string;
  }) {
    super('库存不足', details);
  }
}

/** Moving/adjusting more than the free (unoccupied) stock in the source bin (task §36/§67). */
export class InsufficientMovableStockError extends DomainError {
  readonly code = 'INVENTORY_INSUFFICIENT_MOVABLE_STOCK';
  readonly httpStatus = 409;

  constructor(details: { skuId: string; binId: string; requestedQty: string; movableQty: string }) {
    super('可移动库存不足（存在 Reserved/Picked 占用）', details);
  }
}

/** Quantity fails the NUMERIC(18,3)/positivity rules of the action (task §8). */
export class InventoryQuantityInvalidError extends DomainError {
  readonly code = 'INVENTORY_QUANTITY_INVALID';
  readonly httpStatus = 422;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/** No balance row exists for the target dimension (NO_INVENTORY_RECORD, task §70). */
export class InventoryBalanceNotFoundError extends DomainError {
  readonly code = 'INVENTORY_BALANCE_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(details: { skuId: string; warehouseId?: string; binId?: string }) {
    super('库存记录不存在（未初始化）', details);
  }
}

/** Reservation lifecycle transition not allowed from its current status (task §15). */
export class InvalidReservationStateError extends DomainError {
  readonly code = 'INVENTORY_RESERVATION_STATE_INVALID';
  readonly httpStatus = 409;

  constructor(details: { reservationId: string; currentStatus: string; attemptedAction: string }) {
    super(`预约状态不允许该操作（当前: ${details.currentStatus}）`, details);
  }
}

/**
 * 订单来源的预约只能走订单域入口（2026-10-15 用户 bug 报告）。
 *
 * `reference_type = 'ORDER'` 的预约承载订单行的库存事实：直接对它做
 * release/pick/unpick/ship 会改库存却不同步订单行状态与订单 rollup，制造
 * 「订单页显示已占用、实为已释放」的悬空占用（真实样本 ORD00000142）。
 * 释放走「取消订单」、拣货走拣货任务、出库走发货单——均已有订单域入口并经
 * 库存模块公共 API（AGENTS.md §10）。本错误拦住绕过订单域的裸生命周期调用。
 */
export class OrderOwnedReservationError extends DomainError {
  readonly code = 'INVENTORY_RESERVATION_ORDER_OWNED';
  readonly httpStatus = 409;

  constructor(details: { reservationId: string; attemptedAction: string }) {
    super(
      '订单占用只能通过订单流程变更：释放请在订单页「取消订单」，拣货请走拣货任务，出库请走发货单',
      details,
    );
  }
}

export class ReservationNotFoundError extends DomainError {
  readonly code = 'INVENTORY_RESERVATION_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super('预约不存在', { id });
  }
}

/** Same idempotency key reused with a different business payload (task §22/§61). */
export class IdempotencyConflictError extends DomainError {
  readonly code = 'INVENTORY_IDEMPOTENCY_CONFLICT';
  readonly httpStatus = 409;

  constructor(key: string) {
    super('幂等键已用于其他业务参数', { idempotencyKey: key });
  }
}

export class MoveBinInvalidError extends DomainError {
  readonly code = 'INVENTORY_MOVE_BIN_INVALID';
  readonly httpStatus = 422;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/** The requested balance dimension references are inconsistent (task §6/§37). */
export class InventoryDimensionInvalidError extends DomainError {
  readonly code = 'INVENTORY_DIMENSION_INVALID';
  readonly httpStatus = 422;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/** Reservation references a SKU that no longer exists - data invariant break. */
export class SkuNotFoundInvariantError extends DomainError {
  readonly code = 'INVENTORY_SKU_INVARIANT_BROKEN';
  readonly httpStatus = 500;

  constructor(skuId: string) {
    super('预约引用的 SKU 不存在（数据不一致）', { skuId });
  }
}

/** Reservation line has no matching balance row - data invariant break. */
export class BalanceMissingInvariantError extends DomainError {
  readonly code = 'INVENTORY_BALANCE_INVARIANT_BROKEN';
  readonly httpStatus = 500;

  constructor(details: { skuId: string; warehouseId: string; binId: string }) {
    super('预约行对应的库存记录缺失（数据不一致）', details);
  }
}

/** Adjustment would drive On Hand negative or below occupied stock (task §68). */
export class AdjustmentInvalidError extends DomainError {
  readonly code = 'INVENTORY_ADJUSTMENT_INVALID';
  readonly httpStatus = 409;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/**
 * Serial-number rule violation (Sprint 3 task §42-§44): SN count mismatch,
 * duplicate SN, SN provided for a non-serial SKU, or an SN that does not
 * belong to the reservation being picked.
 */
export class InventorySerialInvalidError extends DomainError {
  readonly code = 'INVENTORY_SERIAL_INVALID';
  readonly httpStatus = 422;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}
