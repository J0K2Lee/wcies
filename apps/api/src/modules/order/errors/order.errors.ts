import { DomainError } from '../../../common/errors/domain.error';

export class OrderNotFoundError extends DomainError {
  readonly code = 'ORDER_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super('订单不存在', { id });
  }
}

export class OrderItemNotFoundError extends DomainError {
  readonly code = 'ORDER_ITEM_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super('订单行不存在', { id });
  }
}

/**
 * The order cannot move to the requested state (task §26 exception type
 * ORDER_INVALID_STATE also lands in the exception center for the
 * cancel-during-picking case).
 */
export class OrderInvalidStateError extends DomainError {
  readonly code = 'ORDER_INVALID_STATE';
  readonly httpStatus = 409;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/** Ingestion-level input problems that cannot be attributed to one line. */
export class OrderIngestInvalidError extends DomainError {
  readonly code = 'ORDER_INGEST_INVALID';
  readonly httpStatus = 422;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/**
 * 错误摄入订单的「彻底移除」（2026-10-24 用户指示）：只要该订单产生过真实
 * 业务事实就拒绝——库存流水/占用/拣货/发货/结算/财务/拦截/面单/采购引用
 * 都指向这张单，删掉会断掉追溯链（AGENTS §14/§101.10）。
 */
export class OrderPurgeBlockedError extends DomainError {
  readonly code = 'ORDER_PURGE_BLOCKED';
  readonly httpStatus = 409;

  constructor(orderNo: string, blockers: string[]) {
    super(`订单 ${orderNo} 已产生业务事实，不能删除（${blockers.join('、')}）`, {
      orderNo,
      blockers,
    });
  }
}

/** 已发货/部分发货的单据不允许按错单移除。 */
export class OrderPurgeInvalidStateError extends DomainError {
  readonly code = 'ORDER_PURGE_INVALID_STATE';
  readonly httpStatus = 409;

  constructor(orderNo: string, erpStatus: string) {
    super(`订单 ${orderNo} 状态为 ${erpStatus}，不能按错单移除`, { orderNo, erpStatus });
  }
}

/** 删除是不可逆动作：必须再次输入订单号（与 SKU 合并同一交互约定）。 */
export class OrderPurgeConfirmMismatchError extends DomainError {
  readonly code = 'ORDER_PURGE_CONFIRM_MISMATCH';
  readonly httpStatus = 422;

  constructor(orderNo: string) {
    super(`确认单号与目标订单不一致（应为 ${orderNo}）`, { orderNo });
  }
}
