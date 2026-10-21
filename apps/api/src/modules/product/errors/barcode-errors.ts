import { DomainError } from '../../../common/errors/domain.error';

export class BarcodeNotFoundError extends DomainError {
  readonly code = 'SKU_BARCODE_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super(
      `条码「${id}」未绑定任何 SKU。提示：SKU 编码（如 SKU000001001）不是条码；请扫描商品实物条码，或改用搜索选择 SKU。`,
      { id },
    );
  }
}

export class BarcodeAlreadyExistsError extends DomainError {
  readonly code = 'SKU_BARCODE_ALREADY_EXISTS';
  readonly httpStatus = 409;

  constructor(barcode: string) {
    super(`条码「${barcode}」已被绑定，请使用其他条码或查看已有绑定。`, { barcode });
  }
}

export class BarcodeTypeInvalidError extends DomainError {
  readonly code = 'SKU_BARCODE_TYPE_INVALID';
  readonly httpStatus = 422;

  constructor(barcodeType: string) {
    super(`不支持的条码类型「${barcodeType}」，请选择有效的条码类型。`, { barcodeType });
  }
}

/**
 * 69 码（中国 EAN-13）未通过校验位规则（用户指示 2026-10-21）。
 *
 * 只拦截以 69 开头的值：13 位数字按 EAN-13 校验位验证，非 13 位直接拒绝；
 * 其他条码类型（内部码、厂商码等）不经过此规则。
 */
export class BarcodeInvalidEan13Error extends DomainError {
  readonly code = 'SKU_BARCODE_INVALID_EAN13';
  readonly httpStatus = 422;

  constructor(barcode: string, message: string, expectedCheckDigit: string | null) {
    super(message, { barcode, expectedCheckDigit });
  }
}
