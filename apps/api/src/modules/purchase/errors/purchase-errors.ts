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

/**
 * 订单行「去收货」时该行没有关联的有效采购单（2026-10-16）。
 *
 * 「去收货」只在订单行已有进行中采购（派生采购状态 ORDERED）时可用；若该行
 * 实际无 live PO（状态过期/PO 被取消），明确报错引导先登记采购，不落到「生成
 * 空收货单」或其它不可读错误。
 */
export class OrderLineNotOrderedError extends DomainError {
  readonly code = 'PURCHASE_ORDER_LINE_NOT_ORDERED';
  readonly httpStatus = 409;

  constructor(orderItemId: string) {
    super('该订单行没有进行中的采购单，无法收货；请先登记采购', { orderItemId });
  }
}

/**
 * 同一采购单已有未取消的收货草稿，拒绝再生成第二张（2026-10-15）。
 *
 * 草稿按“生成时刻的未收数量”预填；两张草稿各自都能通过确认校验，先后确认
 * 会把 received_quantity 累加超量、撞上 DB CHECK 报 500。防重必须落在
 * 生成侧：已有草稿时引导操作者编辑确认那张草稿，而不是新开一张。
 */
export class PurchaseReceiptDuplicateDraftError extends DomainError {
  readonly code = 'PURCHASE_RECEIPT_DUPLICATE_DRAFT';
  readonly httpStatus = 409;

  constructor(poNo: string, existingReceiptNo: string) {
    super(
      `采购单 ${poNo} 已有收货草稿 ${existingReceiptNo}，请到收货单页编辑确认后再生成新的收货单`,
      { poNo, existingReceiptNo },
    );
  }
}

/**
 * 确认收货会让采购明细的已收数量超过采购数量（2026-10-15 防御）。
 *
 * 正常路径由生成侧防重挡住，但历史遗留草稿、并发草稿或人工放大数量仍可能
 * 触发；此时必须在事务内给出明确错误，而不是撞 DB CHECK 后回落成 500。
 */
export class PurchaseReceiptExceedsOrderedError extends DomainError {
  readonly code = 'PURCHASE_RECEIPT_EXCEEDS_ORDERED';
  readonly httpStatus = 409;

  constructor(input: {
    skuCode?: string | null;
    orderedQty: string;
    receivedQty: string;
    attemptedQty: string;
  }) {
    const sku = input.skuCode === null || input.skuCode === undefined ? '' : `（${input.skuCode}）`;
    super(
      `本次收货数量${sku}超出采购未收数量：采购 ${input.orderedQty}、已收 ${input.receivedQty}、本次 ${input.attemptedQty}，请调整数量或改做直接收货`,
      input,
    );
  }
}
