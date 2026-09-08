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
