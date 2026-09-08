import { SkuService } from '../../product/services/sku.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { WarehouseBinService } from '../../warehouse/services/warehouse-bin.service';
import { SkuNotFoundError } from '../../product/errors/sku-errors';
import { WarehouseNotFoundError } from '../../warehouse/errors/warehouse-errors';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { InventoryBalanceEntity } from '../entities/inventory-balance.entity';
import { formatQty, parseQty } from '../../../common/utils/quantity';
import { InventoryDimensionInvalidError } from '../errors/inventory.errors';
import { WarehouseBinNotFoundError } from '../../warehouse/errors/warehouse-errors';

export interface DimensionDeps {
  skuService: SkuService;
  warehouseService: WarehouseService;
  binService: WarehouseBinService;
}

export interface ResolvedDimension {
  skuId: string;
  warehouseId: string;
  binId: string;
}

/**
 * Validates the master-data references of a stock action and resolves the
 * balance dimension. binId may be omitted ONLY for stock additions
 * (initialize/receive): a warehouse without any bins gets its virtual
 * DEFAULT bin (task §6); a warehouse WITH bins requires an explicit choice.
 */
export async function resolveDimension(
  deps: DimensionDeps,
  input: { skuId: string; warehouseId: string; binId?: string | null },
  operator: OperatorContext,
): Promise<ResolvedDimension> {
  const sku = await deps.skuService.getEntityById(input.skuId);
  if (sku === null) {
    throw new SkuNotFoundError(input.skuId);
  }
  const warehouse = await deps.warehouseService.getEntityById(input.warehouseId);
  if (warehouse === null) {
    throw new WarehouseNotFoundError(input.warehouseId);
  }

  let binId = input.binId ?? null;
  if (binId === null) {
    const binCount = await deps.binService.countByWarehouse(input.warehouseId);
    if (binCount > 0) {
      throw new InventoryDimensionInvalidError('该仓库已有库位，必须指定 binId', {
        warehouseId: input.warehouseId,
      });
    }
    const defaultBin = await deps.binService.ensureDefaultBin(input.warehouseId, operator);
    binId = defaultBin.id;
  } else {
    const bin = await deps.binService.getEntityById(binId);
    if (bin === null) {
      throw new WarehouseBinNotFoundError(binId);
    }
    if (bin.warehouseId !== input.warehouseId) {
      throw new InventoryDimensionInvalidError('库位不属于该仓库', {
        binId,
        warehouseId: input.warehouseId,
        binWarehouseId: bin.warehouseId,
      });
    }
  }

  return { skuId: input.skuId, warehouseId: input.warehouseId, binId };
}

/** Invariant guard shared by every balance mutation (task §9, inventory.md §52). */
export function assertBalanceInvariants(balance: {
  onHandQty: string;
  reservedQty: string;
  pickedQty: string;
}): void {
  const onHand = parseQty(balance.onHandQty);
  const reserved = parseQty(balance.reservedQty);
  const picked = parseQty(balance.pickedQty);
  if (onHand < 0n || reserved < 0n || picked < 0n) {
    throw new Error(
      `库存不变量被破坏: onHand=${balance.onHandQty} reserved=${balance.reservedQty} picked=${balance.pickedQty}`,
    );
  }
  if (reserved + picked > onHand) {
    throw new Error(
      `库存占用超出实物: onHand=${balance.onHandQty} reserved=${balance.reservedQty} picked=${balance.pickedQty}`,
    );
  }
}

/** Physical available of one balance row: On Hand - Reserved - Picked (task §10). */
export function physicalAvailableOf(balance: {
  onHandQty: string;
  reservedQty: string;
  pickedQty: string;
}): bigint {
  return parseQty(balance.onHandQty) - parseQty(balance.reservedQty) - parseQty(balance.pickedQty);
}

/** Next optimistic version of a locked balance row. */
export function nextVersionOf(balance: InventoryBalanceEntity): string {
  return (BigInt(balance.version) + 1n).toString();
}

/** Formats a milli-unit delta for ledger before/after columns. */
export function fmt(milli: bigint): string {
  return formatQty(milli);
}
