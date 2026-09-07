import { DomainError } from '../../../common/errors/domain.error';

export class WarehouseNotFoundError extends DomainError {
  readonly code = 'WAREHOUSE_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(identifier: string) {
    super(`Warehouse not found: ${identifier}`, { identifier });
  }
}

export class WarehouseCodeAlreadyExistsError extends DomainError {
  readonly code = 'WAREHOUSE_CODE_ALREADY_EXISTS';
  readonly httpStatus = 409;

  constructor(warehouseCode: string) {
    super(`Warehouse code already exists: ${warehouseCode}`, { warehouseCode });
  }
}

export class WarehouseBinAlreadyExistsError extends DomainError {
  readonly code = 'WAREHOUSE_BIN_ALREADY_EXISTS';
  readonly httpStatus = 409;

  constructor(warehouseId: string, binCodes: string[]) {
    super(`Bin code(s) already exist in this warehouse: ${binCodes.join(', ')}`, {
      warehouseId,
      binCodes,
    });
  }
}

export class WarehouseBinNotFoundError extends DomainError {
  readonly code = 'WAREHOUSE_BIN_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super(`Warehouse bin not found: ${id}`, { id });
  }
}

/** Batch bin generation input is malformed or exceeds limits (task §41). */
export class WarehouseBinBatchInvalidError extends DomainError {
  readonly code = 'WAREHOUSE_BIN_BATCH_INVALID';
  readonly httpStatus = 422;

  constructor(message: string) {
    super(message);
  }
}

/** Store/platform/fulfillment-mode/warehouse-type combination rejected (task §45). */
export class StoreWarehouseBindingInvalidError extends DomainError {
  readonly code = 'STORE_WAREHOUSE_BINDING_INVALID';
  readonly httpStatus = 422;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

export class StoreWarehouseBindingNotFoundError extends DomainError {
  readonly code = 'STORE_WAREHOUSE_BINDING_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super(`Store warehouse binding not found: ${id}`, { id });
  }
}
