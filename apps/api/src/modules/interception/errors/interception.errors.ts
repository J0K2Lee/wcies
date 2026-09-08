import { DomainError } from '../../../common/errors/domain.error';

export class InterceptionNotFoundError extends DomainError {
  readonly code = 'INTERCEPTION_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super('拦截任务不存在', { id });
  }
}

/** Wrong-state lifecycle usage (assign/start/scan/return/fail/close). */
export class InterceptionStateInvalidError extends DomainError {
  readonly code = 'INTERCEPTION_STATE_INVALID';
  readonly httpStatus = 409;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/** Scanned SKU is not the SKU this interception looks for (task §35). */
export class InterceptionSkuMismatchError extends DomainError {
  readonly code = 'INTERCEPTION_SKU_MISMATCH';
  readonly httpStatus = 422;

  constructor(details: {
    expectedSkuId?: string | null;
    scannedSkuId?: string;
    scannedBarcode?: string;
  }) {
    super('扫描的 SKU 与拦截任务不一致', details);
  }
}

/** Scanned SN does not belong to the order's picking record (task §36). */
export class InterceptionSerialMismatchError extends DomainError {
  readonly code = 'INTERCEPTION_SERIAL_MISMATCH';
  readonly httpStatus = 422;

  constructor(details: { serialNumber?: string; reason: string }) {
    super(details.reason, details);
  }
}

/** Target bin not found in the interception's warehouse (task §34). */
export class InterceptionBinNotFoundError extends DomainError {
  readonly code = 'INTERCEPTION_BIN_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(details: { warehouseId: string; binBarcode: string }) {
    super('库位条码不属于该拦截任务的仓库', details);
  }
}

/** The goods already left stock - Return/Logistics territory (task §45). */
export class InterceptionNotAllowedAfterShipmentError extends DomainError {
  readonly code = 'INTERCEPTION_NOT_ALLOWED_AFTER_SHIPMENT';
  readonly httpStatus = 409;

  constructor(details: { interceptionId: string; shipmentId?: string }) {
    super('商品已出库，禁止仓内拦截（请走退货/物流流程）', details);
  }
}

/** Barcode not resolvable to any SKU (interception scan). */
export class InterceptionBarcodeNotFoundError extends DomainError {
  readonly code = 'INTERCEPTION_BARCODE_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(barcode: string) {
    super('条码未识别（没有对应 SKU）', { barcode });
  }
}
