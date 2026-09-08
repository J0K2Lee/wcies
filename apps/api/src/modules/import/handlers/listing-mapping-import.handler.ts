import { Injectable } from '@nestjs/common';
import { ListingService } from '../../listing/services/listing.service';
import { PlatformService } from '../../platform/platform.service';
import { SkuService } from '../../product/services/sku.service';
import { StoreService } from '../../store/services/store.service';
import { ImportRowError } from '../entities/import-job.entity';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { optionalField, requiredField } from '../services/excel-parser';
import { ImportHandler, ImportRowContext, ValidRow } from './import-handler';

interface ListingMappingRowData {
  platformCode: string;
  storeCode: string;
  platformProductId: string;
  platformSkuId: string | null;
  sellerSku: string | null;
  offerId: string | null;
  internalSkuCode: string;
  title: string | null;
  url: string | null;
}

/**
 * LISTING_MAPPING fixed template (spec §88):
 * platform | store_code | platform_product_id | platform_sku_id | seller_sku |
 * offer_id | internal_sku_code | title | url
 *
 * Unknown platform / store / internal SKU -> exact row error. An existing
 * listing (store + platform_product_id) is reused and the mapping appended;
 * an already-existing identical mapping is rejected (task §61).
 */
@Injectable()
export class ListingMappingImportHandler implements ImportHandler {
  readonly type = 'LISTING_MAPPING';

  constructor(
    private readonly platformService: PlatformService,
    private readonly storeService: StoreService,
    private readonly skuService: SkuService,
    private readonly listingService: ListingService,
  ) {}

  async validate(
    rows: Array<{ rowNumber: number; cells: Record<string, string> }>,
  ): Promise<{ validRows: ValidRow[]; errors: ImportRowError[] }> {
    const errors: ImportRowError[] = [];
    const validRows: ValidRow[] = [];

    for (const { rowNumber, cells } of rows) {
      const before = errors.length;
      const platformCode = requiredField(rowNumber, cells, 'platform', errors);
      const storeCode = requiredField(rowNumber, cells, 'store_code', errors);
      const platformProductId = requiredField(rowNumber, cells, 'platform_product_id', errors);
      const internalSkuCode = requiredField(rowNumber, cells, 'internal_sku_code', errors);

      let storeId: string | null = null;
      if (platformCode !== '') {
        const platform = await this.platformService.getEntityByCode(platformCode);
        if (platform === null) {
          errors.push({
            row: rowNumber,
            field: 'platform',
            code: 'PLATFORM_NOT_FOUND',
            message: `平台不存在: ${platformCode}`,
          });
        } else if (storeCode !== '') {
          const store = await this.storeService.getEntityByPlatformAndCode(platform.id, storeCode);
          if (store === null) {
            errors.push({
              row: rowNumber,
              field: 'store_code',
              code: 'STORE_NOT_FOUND',
              message: `店铺不存在: ${platformCode}/${storeCode}`,
            });
          } else {
            storeId = store.id;
          }
        }
      }

      if (internalSkuCode !== '') {
        const sku = await this.skuService.getEntityByCode(internalSkuCode);
        if (sku === null) {
          errors.push({
            row: rowNumber,
            field: 'internal_sku_code',
            code: 'SKU_NOT_FOUND',
            message: `内部 SKU 不存在: ${internalSkuCode}`,
          });
        }
      }

      if (errors.length > before || storeId === null) {
        continue;
      }
      validRows.push({
        rowNumber,
        data: {
          platformCode,
          storeCode,
          platformProductId,
          platformSkuId: optionalField(cells, 'platform_sku_id'),
          sellerSku: optionalField(cells, 'seller_sku'),
          offerId: optionalField(cells, 'offer_id'),
          internalSkuCode,
          title: optionalField(cells, 'title'),
          url: optionalField(cells, 'url'),
        },
      });
    }
    return { validRows, errors };
  }

  async importRow(
    raw: Record<string, unknown>,
    operator: OperatorContext,

    _context: ImportRowContext,
  ): Promise<void> {
    const row = raw as unknown as ListingMappingRowData;
    const platform = await this.platformService.getEntityByCode(row.platformCode);
    if (platform === null) {
      throw new Error(`Platform not found: ${row.platformCode}`);
    }
    const store = await this.storeService.getEntityByPlatformAndCode(platform.id, row.storeCode);
    if (store === null) {
      throw new Error(`Store not found: ${row.storeCode}`);
    }
    const sku = await this.skuService.getEntityByCode(row.internalSkuCode);
    if (sku === null) {
      throw new Error(`SKU not found: ${row.internalSkuCode}`);
    }

    // Reuse the listing if it already exists (store + platform_product_id).
    const listing = await this.listingService.getOrCreateListingForImport(
      {
        platformId: platform.id,
        storeId: store.id,
        platformProductId: row.platformProductId,
        title: row.title,
        url: row.url,
      },
      operator,
    );
    await this.listingService.addMappingForImport(
      {
        listingId: listing.id,
        skuId: sku.id,
        platformSkuId: row.platformSkuId,
        sellerSku: row.sellerSku,
        offerId: row.offerId,
      },
      operator,
    );
  }
}
