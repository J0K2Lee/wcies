import { DomainError } from '../../../common/errors/domain.error';

export class ShipmentNotFoundError extends DomainError {
  readonly code = 'SHIPMENT_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super('发货单不存在', { id });
  }
}

export class PackageNotFoundError extends DomainError {
  readonly code = 'PACKAGE_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super('包裹不存在', { id });
  }
}

/** Shipment lifecycle misuse (ship/scan/pack from the wrong status). */
export class ShipmentStateInvalidError extends DomainError {
  readonly code = 'SHIPMENT_STATE_INVALID';
  readonly httpStatus = 409;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/** No PICKED order lines available for a new shipment (task §13). */
export class ShipmentNoEligibleItemsError extends DomainError {
  readonly code = 'SHIPMENT_NO_ELIGIBLE_ITEMS';
  readonly httpStatus = 422;

  constructor(details: { orderId: string }) {
    super('订单没有可发货的行（仅 PICKED 行可进入发货单）', details);
  }
}

/** Packed totals do not cover the shipment snapshot (task §16/§66). */
export class ShipmentNotFullyPackedError extends DomainError {
  readonly code = 'SHIPMENT_NOT_FULLY_PACKED';
  readonly httpStatus = 409;

  constructor(details: {
    shipmentId: string;
    shortfalls: Array<{ skuId: string; requiredQty: string; packedQty: string }>;
  }) {
    super('发货单未完成打包（包裹数量必须等于待发数量）', details);
  }
}

/** Scanned barcode does not resolve to any SKU (packing, task §17). */
export class PackingBarcodeNotFoundError extends DomainError {
  readonly code = 'PACKING_BARCODE_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(barcode: string) {
    super('条码未识别（没有对应 SKU）', { barcode });
  }
}

/** Scanned SKU is not waiting in this shipment (task §17/§67). */
export class PackingSkuMismatchError extends DomainError {
  readonly code = 'PACKING_SKU_MISMATCH';
  readonly httpStatus = 422;

  constructor(details: { scannedSkuId?: string; scannedBarcode?: string; shipmentId: string }) {
    super('扫描的 SKU 与该发货单待打包商品不一致', details);
  }
}

/** Packed qty would exceed the picked qty (task §17/§68). */
export class PackingQuantityExceededError extends DomainError {
  readonly code = 'PACKING_QUANTITY_EXCEEDED';
  readonly httpStatus = 422;

  constructor(details: {
    packageId: string;
    orderItemId: string;
    requiredQty: string;
    packedQty: string;
  }) {
    super('该商品打包数量已完成，拒绝超量扫描', details);
  }
}

/** SN problems while packing (task §18). */
export class PackingSerialInvalidError extends DomainError {
  readonly code = 'PACKING_SERIAL_INVALID';
  readonly httpStatus = 422;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/** Sealing an empty package is meaningless. */
export class PackageEmptyError extends DomainError {
  readonly code = 'PACKAGE_EMPTY';
  readonly httpStatus = 422;

  constructor(details: { packageId: string }) {
    super('空包裹不能封箱', details);
  }
}

/** Label upload problems (type/size, task §19-§20). */
export class ShippingLabelInvalidError extends DomainError {
  readonly code = 'SHIPPING_LABEL_INVALID';
  readonly httpStatus = 422;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/** Invalid polymorphic void source (void_source_type / void_source_id). */
export class ShipmentVoidSourceInvalidError extends DomainError {
  readonly code = 'SHIPMENT_VOID_SOURCE_INVALID';
  readonly httpStatus = 422;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}
