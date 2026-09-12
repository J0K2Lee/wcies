import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { ObjectStorageService } from '../../../infrastructure/storage/object-storage.service';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ListingService } from './listing.service';

/** Column order of the LISTING_MAPPING import template (§1.3) - the export
 * must stay column-identical so "export -> fill -> import" round-trips. */
const EXPORT_COLUMNS = [
  'platform',
  'store_code',
  'platform_product_id',
  'platform_sku_id',
  'seller_sku',
  'offer_id',
  'internal_sku_code',
  'title',
  'url',
] as const;

export interface UnmappedListingExportResult {
  objectKey: string;
  downloadUrl: string;
  rowCount: number;
}

/**
 * Sprint 8 T2 - the missing half of the LISTING_MAPPING Excel loop.
 *
 * Exports unmapped ACTIVE variant rows column-identical to the import
 * template with `internal_sku_code` left empty for the user to fill; already
 * mapped rows are not exported. Generation runs synchronously: the realistic
 * volume is ~1.3k rows (planning §1.2), which builds in well under a second,
 * so no BullMQ round-trip is spent (§50 targets LONG tasks). The file goes
 * to object storage like every other artifact and is downloaded through a
 * short-lived signed URL (AGENTS.md §68).
 */
@Injectable()
export class ListingExportService {
  constructor(
    private readonly listingService: ListingService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  async exportUnmapped(
    filters: { platformId?: string; storeId?: string },
    _operator: OperatorContext,
  ): Promise<UnmappedListingExportResult> {
    const rows = await this.listingService.listUnmappedVariantsForExport(filters);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('unmapped');
    sheet.addRow([...EXPORT_COLUMNS]);
    for (const row of rows) {
      // internal_sku_code intentionally left empty - that is the column the
      // user fills in before importing back.
      sheet.addRow([
        row.platformCode,
        row.storeCode,
        row.platformProductId,
        row.platformSkuId ?? '',
        row.sellerSku ?? '',
        row.offerId ?? '',
        '',
        row.title ?? '',
        row.url ?? '',
      ]);
    }
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const objectKey = `exports/unmapped-listings/${Date.now()}-unmapped-listings.xlsx`;
    await this.objectStorage.upload({
      key: objectKey,
      body: buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const downloadUrl = await this.objectStorage.getSignedUrl(objectKey);
    return { objectKey, downloadUrl, rowCount: rows.length };
  }
}
