import { DomainError } from '../../../common/errors/domain.error';

export class SupplierNotFoundError extends DomainError {
  readonly code = 'SUPPLIER_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(identifier: string) {
    super(`Supplier not found: ${identifier}`, { identifier });
  }
}

export class SupplierCodeAlreadyExistsError extends DomainError {
  readonly code = 'SUPPLIER_CODE_ALREADY_EXISTS';
  readonly httpStatus = 409;

  constructor(code: string) {
    super(`Supplier code already exists: ${code}`, { code });
  }
}

/** Supplier referenced by purchase documents - hard delete refused (decision 0003). */
export class SupplierInUseError extends DomainError {
  readonly code = 'SUPPLIER_IN_USE';
  readonly httpStatus = 409;

  constructor(tables: string[]) {
    super(`该供应商已被引用（${tables.join('、')}），只能停用不能删除`, { tables });
  }
}

export class PurchaseOrderNotFoundError extends DomainError {
  readonly code = 'PURCHASE_ORDER_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(identifier: string) {
    super(`Purchase order not found: ${identifier}`, { identifier });
  }
}

/** PO state machine violation (edit/cancel in the wrong status, purchase.md §3.2/§3.3). */
export class PurchaseOrderInvalidStateError extends DomainError {
  readonly code = 'PURCHASE_ORDER_INVALID_STATE';
  readonly httpStatus = 409;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/** Same order line registered for purchase twice (purchase.md §3.4). */
export class PurchaseOrderItemAlreadyOrderedError extends DomainError {
  readonly code = 'PURCHASE_ORDER_ITEM_ALREADY_ORDERED';
  readonly httpStatus = 409;

  constructor(poNo: string, orderedAt: Date) {
    super(`该订单行已于 ${orderedAt.toISOString()} 登记采购（${poNo}）`, { poNo });
  }
}

export class PurchaseReceiptNotFoundError extends DomainError {
  readonly code = 'PURCHASE_RECEIPT_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(identifier: string) {
    super(`Purchase receipt not found: ${identifier}`, { identifier });
  }
}

/** Receipt state machine violation (confirm/edit in the wrong status, purchase.md §4.2). */
export class PurchaseReceiptInvalidStateError extends DomainError {
  readonly code = 'PURCHASE_RECEIPT_INVALID_STATE';
  readonly httpStatus = 409;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/** Confirming a receipt without items is meaningless (purchase.md §4.3). */
export class PurchaseReceiptEmptyError extends DomainError {
  readonly code = 'PURCHASE_RECEIPT_EMPTY';
  readonly httpStatus = 422;

  constructor(receiptId: string) {
    super('收货单没有任何明细，不能确认收货', { receiptId });
  }
}

/**
 * 从采购单生成收货单时既没有显式指定仓库、PO 上也没有收货仓库意向
 * （2026-09-28，ERP 建议#4：PO 创建时选过的仓库应被缺省使用）。
 */
export class PurchaseReceiptWarehouseMissingError extends DomainError {
  readonly code = 'PURCHASE_RECEIPT_WAREHOUSE_MISSING';
  readonly httpStatus = 422;

  constructor(poNo: string) {
    super(`采购单 ${poNo} 未指定收货仓库，请先选择收货仓库`, { poNo });
  }
}
