import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InternalDomainError } from '../../common/errors/common-errors';

/**
 * Scoped business-code prefixes (decision 0001; master-data.md §1).
 * Warehouse type / platform code keys mirror the platform seed values.
 */
const WAREHOUSE_CODE_PREFIX = {
  SELF: 'ZG',
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

export function warehouseScope(warehouseType: WarehouseCodeType): string {
  return `warehouse:${warehouseType}`;
}

export function storeScope(platformCode: StorePlatformCode): string {
  return `store:${platformCode}`;
}

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

export function formatSkuCode(productSeq: number, inProductSeq: number): string {
  return `SKU${String(productSeq).padStart(6, '0')}${String(inProductSeq).padStart(3, '0')}`;
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
   */
  async next(scopeKey: string): Promise<number> {
    const result = await this.dataSource.query<Array<{ next_value: string | number }>>(
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

  async nextCategoryCode(): Promise<string> {
    return formatCategoryCode(await this.next(SCOPE_CATEGORY));
  }

  /** Returns both the formatted PN code and the raw seq (products.code_seq). */
  async nextProductCode(): Promise<{ productCode: string; codeSeq: number }> {
    const codeSeq = await this.next(SCOPE_PRODUCT);
    return { productCode: formatProductCode(codeSeq), codeSeq };
  }

  /**
   * Derived SKU code (decision 0002): SKU{product seq 6}{in-product seq 3}.
   * The per-product scope starts at 1 for every product.
   */
  async nextSkuCode(productId: string, productCodeSeq: number): Promise<string> {
    const inProductSeq = await this.next(skuScope(productId));
    return formatSkuCode(productCodeSeq, inProductSeq);
  }
}
