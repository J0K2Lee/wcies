import { DomainError } from '../../../common/errors/domain.error';

/** Finance module domain errors (finance.md; codes are stable API facts). */

export class FinanceTransactionNotFoundError extends DomainError {
  readonly code = 'FINANCE_TRANSACTION_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(transactionId: string) {
    super('财务流水不存在', { transactionId });
  }
}

export class FinancePayoutNotFoundError extends DomainError {
  readonly code = 'FINANCE_PAYOUT_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(payoutId: string) {
    super('平台回款单不存在', { payoutId });
  }
}

export class FinancePayoutInvalidStateError extends DomainError {
  readonly code = 'FINANCE_PAYOUT_INVALID_STATE';
  readonly httpStatus = 409;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

export class FinanceCategoryDirectionMismatchError extends DomainError {
  readonly code = 'FINANCE_CATEGORY_DIRECTION_MISMATCH';
  readonly httpStatus = 422;
  constructor(category: string, direction: string, expected: string) {
    super('类别与收支方向不匹配', { category, direction, expected });
  }
}

export class FinanceRelationRequiredError extends DomainError {
  readonly code = 'FINANCE_RELATION_REQUIRED';
  readonly httpStatus = 422;
  constructor(required: string[], details: Record<string, unknown> = {}) {
    super(`该类别必须关联：${required.join('、')}`, { required, ...details });
  }
}

export class FinanceRelationNotFoundError extends DomainError {
  readonly code = 'FINANCE_RELATION_NOT_FOUND';
  readonly httpStatus = 422;
  constructor(relation: string, id: string) {
    super(`关联${relation}不存在`, { relation, id });
  }
}

export class FinanceOverpaymentError extends DomainError {
  readonly code = 'FINANCE_OVERPAYMENT';
  readonly httpStatus = 422;
  constructor(details: Record<string, unknown>) {
    super('付款金额超过采购单未付余额', details);
  }
}

export class FinanceAmountInvalidError extends DomainError {
  readonly code = 'FINANCE_AMOUNT_INVALID';
  readonly httpStatus = 422;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

export class FinancePayoutPeriodInvalidError extends DomainError {
  readonly code = 'FINANCE_PAYOUT_PERIOD_INVALID';
  readonly httpStatus = 422;
  constructor() {
    super('回款期间不合法（开始必须不晚于结束）');
  }
}

export class OrderSettlementNotFoundError extends DomainError {
  readonly code = 'ORDER_SETTLEMENT_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(settlementId: string) {
    super('订单结算不存在', { settlementId });
  }
}

export class OrderSettlementNotEligibleError extends DomainError {
  readonly code = 'ORDER_SETTLEMENT_NOT_ELIGIBLE';
  readonly httpStatus = 409;
  constructor(details: Record<string, unknown>) {
    super('订单未发货，不能生成结算（finance.md §5.1）', details);
  }
}

export class OrderSettlementFeeInvalidError extends DomainError {
  readonly code = 'ORDER_SETTLEMENT_FEE_INVALID';
  readonly httpStatus = 422;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}
