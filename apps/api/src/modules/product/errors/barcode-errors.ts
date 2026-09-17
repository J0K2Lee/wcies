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
