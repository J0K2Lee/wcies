import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { InternalDomainError } from '../../common/errors/common-errors';

/**
 * Scoped business-code prefixes (decision 0001; master-data.md §1).
 * Warehouse type / platform code keys mirror the platform seed values.
 */
const WAREHOUSE_CODE_PREFIX = {
  SELF: 'ZG',
  SEMI_MANAGED: 'BT',
  PLATFORM: 'PT',
  THIRD_PARTY: 'SF',
  RETURN_TEMP: 'TH',
} as const;

const PLATFORM_CODE_PREFIX = {
  OZON: 'ON',
  WB: 'WS',
  YANDEX: 'YX',
} as const;

export type WarehouseCodeType = keyof typeof WAREHOUSE_CODE_PREFIX;
export type StorePlatformCode = keyof typeof PLATFORM_CODE_PREFIX;

/** Fixed single-sequence scopes; scoped variants are built via helpers below. */
const SCOPE_BRAND = 'brand';
const SCOPE_CATEGORY = 'category';
const SCOPE_PRODUCT = 'product';
/**
 * Global SKU numbering scope (V1 refactor, decision D2, 2026-10-13): ONE
 * sequence for every internal SKU. Migration 20261013_001 seeds the start at
 * max(existing SKU-namespace numeric suffix) + 1.
 */
const SCOPE_SKU = 'sku';
/** Sprint 7 purchase documents (master-data.md §1; decision 0013 §7). */
const SCOPE_SUPPLIER = 'supplier';
const SCOPE_PURCHASE_ORDER = 'purchase_order';
const SCOPE_PURCHASE_RECEIPT = 'purchase_receipt';
/** Return batch numbering RT%06d (dual-axis T5, returns.md §3.1). */
const SCOPE_RETURN_BATCH = 'return_batch';
/** Finance documents (Sprint 10, finance.md §8). */
const SCOPE_FINANCE_VOUCHER = 'finance_voucher';
const SCOPE_FINANCE_PAYOUT = 'finance_payout';
/** Transfer order numbering TRF%06d (Sprint 10, transfer.md §8). */
const SCOPE_TRANSFER_ORDER = 'transfer_order';

export function warehouseScope(warehouseType: WarehouseCodeType): string {
  return `warehouse:${warehouseType}`;
}

export function storeScope(platformCode: StorePlatformCode): string {
  return `store:${platformCode}`;
}

/**
 * Per-product SKU scope key (decision 0002).
 *
 * @deprecated V1 refactor (decision D2) moved SKU numbering to one global
 * 'sku' scope - use `nextSkuCodeGlobal()`. Removed in T9.
 */
export function skuScope(productId: string): string {
  return `sku:${productId}`;
}

// Width is a MINIMUM width: overflow carries naturally (%02d of 100 -> 100).
export function formatWarehouseCode(warehouseType: WarehouseCodeType, seq: number): string {
  const prefix = WAREHOUSE_CODE_PREFIX[warehouseType];
  return `${prefix}-${String(seq).padStart(2, '0')}`;
}

export function formatStoreCode(platformCode: StorePlatformCode, seq: number): string {
  const prefix = PLATFORM_CODE_PREFIX[platformCode];
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

export function formatBrandCode(seq: number): string {
  return `BN${String(seq).padStart(5, '0')}`;
}

export function formatCategoryCode(seq: number): string {
  return `CN${String(seq).padStart(5, '0')}`;
}

export function formatProductCode(seq: number): string {
  return `PN${String(seq).padStart(6, '0')}`;
}

/**
 * Global SKU code (V1 refactor, decision D2, 2026-10-13): SKU%09d - one
 * global sequence for every internal SKU, replacing the derived
 * SKU{product seq 6}{in-product seq 3} (decision 0002).
 *
 * Width is a MINIMUM width: overflow carries naturally (%09d of 1000000000
 * -> "1000000000"), never an error.
 */
export function formatSkuCode(seq: number): string {
  return `SKU${String(seq).padStart(9, '0')}`;
}

/** Supplier SUP%04d (Sprint 7, master-data.md §1). */
export function formatSupplierCode(seq: number): string {
  return `SUP${String(seq).padStart(4, '0')}`;
}

/** Purchase order PO%06d (Sprint 7, master-data.md §1). */
export function formatPurchaseOrderNo(seq: number): string {
  return `PO${String(seq).padStart(6, '0')}`;
}

/** Purchase receipt PR%06d (Sprint 7, master-data.md §1). */
export function formatPurchaseReceiptNo(seq: number): string {
  return `PR${String(seq).padStart(6, '0')}`;
}

/**
 * Atomic scoped numbering over business_code_sequences (decision 0001).
 *
 * One INSERT ... ON CONFLICT DO UPDATE ... RETURNING statement per take:
 * no read-modify-write window, concurrent takes of the same scope are
 * serialized by the row lock and can never hand out the same number.
 */
@Injectable()
export class BusinessCodeService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Takes the next number for a scope. The stored next_value is the last
   * handed-out number; the conflict branch increments before returning.
   * (pg drivers may return bigint as string - always coerce.)
   *
   * An optional EntityManager lets multi-document flows (e.g. listing quick
   * onboarding) consume the sequence INSIDE their transaction, so a rollback
   * does not burn numbers and code_seq stays dense.
   */
  async next(scopeKey: string, manager?: EntityManager): Promise<number> {
    const executor = manager ?? this.dataSource;
    const result = await executor.query<Array<{ next_value: string | number }>>(
      `INSERT INTO business_code_sequences (scope_key, next_value, updated_at)
       VALUES ($1, 1, now())
       ON CONFLICT (scope_key)
       DO UPDATE SET next_value = business_code_sequences.next_value + 1,
                     updated_at = now()
       RETURNING next_value`,
      [scopeKey],
    );
    return Number(result[0]?.next_value ?? Number.NaN);
  }

  /**
   * Takes `count` consecutive numbers from a scope in ONE statement
   * (Sprint 8.5 T3b: the tree import needs ~8k category codes and must not
   * issue one UPSERT per code inside its transaction). Returns the inclusive
   * [from, to] range.
   */
  async nextRange(
    scopeKey: string,
    count: number,
    manager?: EntityManager,
  ): Promise<{ from: number; to: number }> {
    const executor = manager ?? this.dataSource;
    const result = await executor.query<
      Array<{ from_value: string | number; to_value: string | number }>
    >(
      `INSERT INTO business_code_sequences (scope_key, next_value, updated_at)
       VALUES ($1, $2::bigint, now())
       ON CONFLICT (scope_key)
       DO UPDATE SET next_value = business_code_sequences.next_value + $2::bigint,
                     updated_at = now()
       RETURNING next_value - $2::bigint + 1 AS from_value, next_value AS to_value`,
      [scopeKey, count],
    );
    return {
      from: Number(result[0]?.from_value ?? Number.NaN),
      to: Number(result[0]?.to_value ?? Number.NaN),
    };
  }

  async nextWarehouseCode(warehouseType: WarehouseCodeType): Promise<string> {
    return formatWarehouseCode(warehouseType, await this.next(warehouseScope(warehouseType)));
  }

  async nextStoreCode(platformCode: string): Promise<string> {
    const prefixKey = platformCode as StorePlatformCode;
    if (!(prefixKey in PLATFORM_CODE_PREFIX)) {
      throw new InternalDomainError(`No store code prefix for platform "${platformCode}"`);
    }
    return formatStoreCode(prefixKey, await this.next(storeScope(prefixKey)));
  }

  async nextBrandCode(): Promise<string> {
    return formatBrandCode(await this.next(SCOPE_BRAND));
  }

  /** Supplier code SUP%04d (Sprint 7). */
  async nextSupplierCode(): Promise<string> {
    return formatSupplierCode(await this.next(SCOPE_SUPPLIER));
  }

  /** Purchase order number PO%06d (Sprint 7). */
  async nextPurchaseOrderNo(): Promise<string> {
    return formatPurchaseOrderNo(await this.next(SCOPE_PURCHASE_ORDER));
  }

  /** Purchase receipt number PR%06d (Sprint 7). */
  async nextPurchaseReceiptNo(): Promise<string> {
    return formatPurchaseReceiptNo(await this.next(SCOPE_PURCHASE_RECEIPT));
  }

  /** Return batch number RT%06d (dual-axis T5). */
  async nextReturnBatchNo(): Promise<string> {
    const seq = await this.next(SCOPE_RETURN_BATCH);
    return `RT${String(seq).padStart(6, '0')}`;
  }

  /** Finance voucher number FV%06d (Sprint 10, finance.md §8). */
  async nextFinanceVoucherNo(manager?: EntityManager): Promise<string> {
    const seq = await this.next(SCOPE_FINANCE_VOUCHER, manager);
    return `FV${String(seq).padStart(6, '0')}`;
  }

  /** Finance payout number PY%06d (Sprint 10, finance.md §8). */
  async nextFinancePayoutNo(manager?: EntityManager): Promise<string> {
    const seq = await this.next(SCOPE_FINANCE_PAYOUT, manager);
    return `PY${String(seq).padStart(6, '0')}`;
  }

  /** Transfer order number TRF%06d (Sprint 10, transfer.md §2). */
  async nextTransferNo(manager?: EntityManager): Promise<string> {
    const seq = await this.next(SCOPE_TRANSFER_ORDER, manager);
    return `TRF${String(seq).padStart(6, '0')}`;
  }

  async nextCategoryCode(): Promise<string> {
    return formatCategoryCode(await this.next(SCOPE_CATEGORY));
  }

  /** Returns both the formatted PN code and the raw seq (products.code_seq). */
  async nextProductCode(
    manager?: EntityManager,
  ): Promise<{ productCode: string; codeSeq: number }> {
    const codeSeq = await this.next(SCOPE_PRODUCT, manager);
    return { productCode: formatProductCode(codeSeq), codeSeq };
  }

  /**
   * Global SKU code (V1 refactor, decision D2): SKU%09d from the single
   * 'sku' scope. The scope start was seeded by migration 20261013_001 at
   * max(existing SKU-namespace numeric suffix) + 1, so the first take never
   * reuses a frozen existing code. An optional EntityManager consumes the
   * sequence INSIDE the caller's transaction (listing quick onboarding), so
   * a rollback does not burn numbers.
   */
  async nextSkuCodeGlobal(manager?: EntityManager): Promise<string> {
    return formatSkuCode(await this.next(SCOPE_SKU, manager));
  }

  /**
   * Derived SKU code (decision 0002): SKU{product seq 6}{in-product seq 3}.
   * The per-product scope starts at 1 for every product.
   *
   * @deprecated V1 refactor (decision D2) replaced derived codes with the
   * global SKU%09d sequence - use `nextSkuCodeGlobal()`. Kept (behavior
   * unchanged) until the last caller is migrated; removed in T9.
   */
  async nextSkuCode(
    productId: string,
    productCodeSeq: number,
    manager?: EntityManager,
  ): Promise<string> {
    const inProductSeq = await this.next(skuScope(productId), manager);
    // Formatting stays local: the shared formatSkuCode now emits the global
    // SKU%09d shape, and this deprecated path must keep its exact old shape.
    return `SKU${String(productCodeSeq).padStart(6, '0')}${String(inProductSeq).padStart(3, '0')}`;
  }
}
