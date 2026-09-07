import { DomainError } from '../../../common/errors/domain.error';

export class BarcodeNotFoundError extends DomainError {
  readonly code = 'SKU_BARCODE_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super(`Barcode not found: ${id}`, { id });
  }
}

export class BarcodeAlreadyExistsError extends DomainError {
  readonly code = 'SKU_BARCODE_ALREADY_EXISTS';
  readonly httpStatus = 409;

  constructor(barcode: string) {
    super(`Barcode already bound to another SKU: ${barcode}`, { barcode });
  }
}

export class BarcodeTypeInvalidError extends DomainError {
  readonly code = 'SKU_BARCODE_TYPE_INVALID';
  readonly httpStatus = 422;

  constructor(barcodeType: string) {
    super(`Unknown barcode type: ${barcodeType}`, { barcodeType });
  }
}
