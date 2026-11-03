import { DomainError } from '../../../common/errors/domain.error';

export class PickingTaskNotFoundError extends DomainError {
  readonly code = 'PICKING_TASK_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super('拣货任务不存在', { id });
  }
}

/** Task lifecycle misuse (start/scan/complete from the wrong status). */
export class PickingTaskStateInvalidError extends DomainError {
  readonly code = 'PICKING_TASK_STATE_INVALID';
  readonly httpStatus = 409;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/** Scanned barcode does not resolve to any SKU (task §35). */
export class PickingBarcodeNotFoundError extends DomainError {
  readonly code = 'PICKING_BARCODE_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(barcode: string) {
    super('条码未识别（没有对应 SKU）', { barcode });
  }
}

/** Scanned SKU is not the SKU this task is waiting for (task §36/§75). */
export class PickingSkuMismatchError extends DomainError {
  readonly code = 'PICKING_SKU_MISMATCH';
  readonly httpStatus = 422;

  constructor(details: {
    expectedSkuId?: string;
    expectedSkuCode?: string;
    scannedSkuId?: string;
    scannedBarcode?: string;
  }) {
    super('扫描的 SKU 与待拣行不一致', details);
  }
}

/** pickedQty + 1 > requiredQty (task §40/§77). */
export class PickingQuantityExceededError extends DomainError {
  readonly code = 'PICKING_QUANTITY_EXCEEDED';
  readonly httpStatus = 422;

  constructor(details: { pickingTaskItemId: string; requiredQty: string; pickedQty: string }) {
    super('该行拣货数量已完成，拒绝超量扫描', details);
  }
}

/** Serial-tracked SKU scanned without an SN (task §41). */
export class PickingSerialRequiredError extends DomainError {
  readonly code = 'PICKING_SERIAL_REQUIRED';
  readonly httpStatus = 422;

  constructor(details: { pickingTaskItemId: string }) {
    super('该 SKU 启用 SN 管理，必须扫描序列号', details);
  }
}

/** SN does not belong to the line's reservation / wrong state (task §41). */
export class PickingSerialInvalidError extends DomainError {
  readonly code = 'PICKING_SERIAL_INVALID';
  readonly httpStatus = 422;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/** complete() called while items remain unpicked (task §38/§76). */
export class PickingIncompleteError extends DomainError {
  readonly code = 'PICKING_INCOMPLETE';
  readonly httpStatus = 409;

  constructor(details: { pickingTaskId: string; pendingItems: number }) {
    super('存在未完成的拣货行，不能结束任务', details);
  }
}

/** No RESERVED order items to pick (task §32). */
export class PickingNoEligibleItemsError extends DomainError {
  readonly code = 'PICKING_NO_ELIGIBLE_ITEMS';
  readonly httpStatus = 422;

  constructor(details: { orderId: string }) {
    super('订单没有可拣货的行（仅 RESERVED 行可进入拣货任务）', details);
  }
}

/** binBarcode provided but not a bin of the task warehouse (task §51). */
export class PickingBinNotFoundError extends DomainError {
  readonly code = 'PICKING_BIN_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(details: { warehouseId: string; binBarcode: string }) {
    super('库位条码不属于该拣货任务仓库', details);
  }
}

/**
 * 订单已取消时继续拣货（2026-11-03）。
 *
 * 取消链路会把该订单在任务里的未拣行撤出（部分拣的行保留已拣部分），正常情况
 * 下拣货员根本扫不到这些行；这个错误是**兜底**：覆盖「平台取消已落库、撤行还
 * 没执行」的那几秒窗口，让拣货员下一次扫码就立刻停手，而不是把剩下的拣完。
 */
export class PickingOrderCancelledError extends DomainError {
  readonly code = 'PICKING_ORDER_CANCELLED';
  readonly httpStatus = 409;

  constructor(input: { orderNo: string | null; pickingTaskItemId: string }) {
    super(
      `订单${input.orderNo === null ? '' : ` ${input.orderNo}`} 已取消，请停止拣货（已拣部分将进入拦截）`,
      input,
    );
  }
}
