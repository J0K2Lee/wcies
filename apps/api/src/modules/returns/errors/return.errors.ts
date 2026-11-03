import { DomainError } from '../../../common/errors/domain.error';

/** Return-domain errors (dual-axis T5, returns.md). Stable codes. */

export class ReturnBatchNotFoundError extends DomainError {
  readonly code = 'RETURN_BATCH_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(batchId: string) {
    super(`退货批次不存在：${batchId}`, { batchId });
  }
}

export class ReturnBatchInvalidStateError extends DomainError {
  readonly code = 'RETURN_BATCH_INVALID_STATE';
  readonly httpStatus = 409;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

export class ReturnItemInvalidConditionError extends DomainError {
  readonly code = 'RETURN_ITEM_INVALID_CONDITION';
  readonly httpStatus = 409;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

export class ReturnBinNotFoundError extends DomainError {
  readonly code = 'RETURN_BIN_NOT_FOUND';
  readonly httpStatus = 409;

  constructor(details: Record<string, unknown>) {
    super('目标库位不存在或不属于该退货仓库', details);
  }
}

/** 扫码退货：条码未识别（没有对应 SKU）。 */
export class ReturnScanBarcodeNotFoundError extends DomainError {
  readonly code = 'RETURN_SCAN_BARCODE_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(barcode: string) {
    super('条码未识别（没有对应 SKU）', { barcode });
  }
}

/** 扫码退货：该 SKU 在本批次没有待检验行（可能不属于本批或已处理）。 */
export class ReturnScanNoLineError extends DomainError {
  readonly code = 'RETURN_SCAN_NO_LINE';
  readonly httpStatus = 422;

  constructor(details: { batchNo: string; skuCode: string }) {
    super(`SKU ${details.skuCode} 在批次 ${details.batchNo} 没有待检验行`, details);
  }
}

/** 扫码退货：SN 商品必须扫序列号。 */
export class ReturnScanSerialRequiredError extends DomainError {
  readonly code = 'RETURN_SCAN_SERIAL_REQUIRED';
  readonly httpStatus = 422;

  constructor(details: { skuCode: string }) {
    super(`SKU ${details.skuCode} 启用 SN 管理，必须扫描序列号`, details);
  }
}

/** 扫码退货：同一条码行重复扫同一个序列号。 */
export class ReturnScanSerialDuplicateError extends DomainError {
  readonly code = 'RETURN_SCAN_SERIAL_DUPLICATE';
  readonly httpStatus = 422;

  constructor(details: { serialNumber: string; itemId: string }) {
    super(`序列号 ${details.serialNumber} 已在该退货行扫描过`, details);
  }
}
