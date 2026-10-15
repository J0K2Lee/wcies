import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { SkuImageImportService } from '../../product/services/sku-image-import.service';
import { BarcodeService } from '../../product/services/barcode.service';
import { SkuService } from '../../product/services/sku.service';
import {
  ListingNotFoundError,
  ListingOnboardNameRequiredError,
  ListingSkuMappingInvalidStateError,
  ListingSkuMappingNotFoundError,
} from '../errors/listing-errors';
import { ListingRepository } from '../repositories/listing.repository';
import { PlatformCategoryMappingRepository } from '../repositories/platform-category-mapping.repository';
import { ListingService } from './listing.service';
import {
  ListingOnboardContextDto,
  ListingOnboardRequestDto,
  ListingOnboardResponseDto,
  OnboardContextVariantDto,
} from '../dto/listing.dto';

const SKU_ENTITY = 'SKU';
const BARCODE_ENTITY = 'SKU_BARCODE';
const MAPPING_ENTITY = 'PLATFORM_LISTING_SKU';

/**
 * Structural views of what the product module's InTx participants return.
 * Entity CLASSES stay inside the product module (AGENTS.md §9 / arch Rule 4) -
 * the orchestrator only consumes these fields.
 */
interface OnboardedSku {
  id: string;
  skuCode: string;
  nameZh: string;
}

interface OnboardedBarcode {
  id: string;
  barcode: string;
}

export interface OnboardingOutcome {
  sku: OnboardedSku;
  barcode: OnboardedBarcode | null;
  mapping: { id: string; mappingStatus: string };
}

/**
 * Sprint 8 T1 - quick onboarding from an unmapped listing variant.
 *
 * Compresses "create SKU -> (optional) internal barcode -> map the variant"
 * into ONE action. The writes span the product and listing modules, so THIS
 * service owns the transaction boundary and the modules participate through
 * their public *InTx methods (AGENTS.md §7/§9 - no cross-module repository
 * imports). Any failure rolls everything back: a "SKU created but never
 * mapped" half-product must not exist.
 *
 * Quick-onboarding may only start from an UNMAPPED variant row - a mapped
 * row keeps its binding until explicitly changed (planning §T1.6).
 * Operation logs are written AFTER the commit, so a rollback leaves no
 * audit orphans.
 *
 * V1 refactor (2026-10-13, decisions D2/D3/D5): the product layer is gone -
 * the transaction creates the SKU directly (ACTIVE, global SKU%09d code,
 * brand/category landing on the SKU itself); multi-variant "attach to the
 * first product" no longer exists - every variant gets its own SKU.
 *
 * Sprint 8.5 (planning §T1/T3c/T5/T6):
 * - T1: the transaction STARTS by locking the mapping row (FOR UPDATE) and
 *   re-checking UNMAPPED under the lock - the check-create-map sequence is
 *   fully serialized, concurrent double onboards leave the loser with the
 *   same 409 and zero master-data side effects.
 * - T3c: an optional "remember this mapping" row (platform composite
 *   category key -> internal category) is written in the SAME transaction.
 * - T5: editable prefilled dimensions/weight with the regular all-or-none
 *   and backend-computed-volume rules.
 * - T6: the variant's CDN image import is ENQUEUED after the commit -
 *   image failures never touch onboarding facts.
 */
@Injectable()
export class ListingOnboardingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly repository: ListingRepository,
    private readonly skuService: SkuService,
    private readonly barcodeService: BarcodeService,
    private readonly listingService: ListingService,
    private readonly categoryMappingRepository: PlatformCategoryMappingRepository,
    private readonly skuImageImport: SkuImageImportService,
    private readonly operationLog: OperationLogService,
  ) {}

  async onboard(
    listingId: string,
    mappingId: string,
    dto: ListingOnboardRequestDto,
    operator: OperatorContext,
  ): Promise<ListingOnboardResponseDto> {
    const listing = await this.repository.findListingById(listingId);
    if (listing === null) {
      throw new ListingNotFoundError(listingId);
    }
    const mapping = await this.repository.findMappingById(mappingId);
    if (mapping === null || mapping.listingId !== listingId) {
      throw new ListingSkuMappingNotFoundError(mappingId);
    }

    const fallbackName = listing.title?.trim() ?? '';
    const skuName = (dto.skuNameZh ?? '').trim() || fallbackName;

    const generateBarcode = dto.generateBarcode ?? true;

    const outcome: OnboardingOutcome = await this.dataSource.transaction(async (manager) => {
      // T1: lock the mapping row FIRST; everything below runs serialized
      // against concurrent onboards.
      const locked = await this.repository.lockMappingByIdInTx(manager, mappingId);
      if (locked === null || locked.listingId !== listingId) {
        throw new ListingSkuMappingNotFoundError(mappingId);
      }
      if (locked.skuId !== null) {
        throw new ListingSkuMappingInvalidStateError(mappingId, 'already mapped');
      }

      if (skuName === '') {
        throw new ListingOnboardNameRequiredError();
      }

      const sku = await this.skuService.createForOnboardingInTx(manager, {
        nameZh: skuName,
        brandId: dto.brandId ?? null,
        categoryId: dto.categoryId ?? null,
        weightG: dto.weightG ?? null,
        lengthMm: dto.lengthMm ?? null,
        widthMm: dto.widthMm ?? null,
        heightMm: dto.heightMm ?? null,
        latestPurchasePrice: dto.latestPurchasePrice ?? null,
      });
      const barcode =
        generateBarcode === true
          ? await this.barcodeService.generateInternalInTx(manager, sku.id)
          : null;
      const updatedMapping = await this.listingService.mapUnmappedSkuInTx(
        manager,
        listingId,
        mappingId,
        sku.id,
      );

      // T3c: "remember this mapping" - same transaction, never overwrites an
      // existing mapping row (earlier onboard or tree import wins).
      if (
        (dto.rememberCategoryMapping ?? true) === true &&
        (dto.categoryId ?? null) !== null &&
        locked.rawData !== null
      ) {
        const externalKey = readExternalCategoryKey(locked.rawData);
        if (externalKey !== null) {
          await this.categoryMappingRepository.insertIgnoreInTx(manager, {
            platformId: listing.platformId,
            externalCategoryId: externalKey.externalCategoryId,
            externalTypeId: externalKey.externalTypeId,
            internalCategoryId: dto.categoryId as string,
            source: 'ONBOARD',
            createdBy: operator.userId,
          });
        }
      }

      return {
        sku,
        barcode,
        mapping: updatedMapping,
      };
    });

    // Post-commit audit trail (best-effort by design, OperationLogService).
    await this.operationLog.record({
      entityType: SKU_ENTITY,
      entityId: outcome.sku.id,
      entityCode: outcome.sku.skuCode,
      action: 'CREATE',
      changes: {
        skuCode: { from: null, to: outcome.sku.skuCode },
        source: { from: null, to: `LISTING_ONBOARD:${listingId}` },
      },
      operator,
    });
    if (outcome.barcode !== null) {
      await this.operationLog.record({
        entityType: BARCODE_ENTITY,
        entityId: outcome.barcode.id,
        entityCode: outcome.barcode.barcode,
        action: 'CREATE',
        changes: { barcode: { from: null, to: outcome.barcode.barcode } },
        operator,
      });
    }
    await this.operationLog.record({
      entityType: MAPPING_ENTITY,
      entityId: mappingId,
      entityCode: mapping.offerId ?? mapping.platformSkuId ?? mappingId,
      action: 'MAP',
      changes: {
        mappingStatus: { from: 'UNMAPPED', to: 'MAPPED' },
        skuCode: { from: null, to: outcome.sku.skuCode },
        source: { from: null, to: 'LISTING_ONBOARD' },
      },
      operator,
    });

    // T6: async image transfer - after commit, best-effort; a failure
    // retries in the queue and never affects onboarding facts.
    await this.scheduleImageImport(mappingId, outcome.sku.id);

    // 映射修复后的订单行批量收敛（2026-10-15 bug 修复）：建档把变体落成
    // MAPPED 后，同店铺引用它的 FAILED 订单行自动重试（失败自吞，见
    // ListingService.retryOrderLinesAfterMappingRepair）。
    await this.listingService.retryOrderLinesAfterMappingRepair(mappingId, operator);

    return this.toResponse(listingId, outcome);
  }

  /**
   * Sprint 8.5: one feed for the enhanced onboarding dialog. Everything the
   * dialog needs to prefill (images, category suggestion, dims) - derived,
   * read-only, no new state.
   *
   * V1 (2026-10-13): no attach-target resolution - every variant onboards
   * its own SKU, so there is no "default product" to report.
   */
  async getOnboardContext(listingId: string): Promise<ListingOnboardContextDto> {
    const listing = await this.repository.findListingById(listingId);
    if (listing === null) {
      throw new ListingNotFoundError(listingId);
    }
    const rows = await this.repository.listOnboardContextVariants(listingId);

    // Composite-key suggestions for every variant carrying platform keys.
    const keys = rows
      .map((row) => readExternalCategoryKey(row.mapping.rawData))
      .filter((key): key is { externalCategoryId: string; externalTypeId: string } => key !== null);
    const suggestions = new Map<string, string>();
    if (keys.length > 0) {
      const mappings = await this.categoryMappingRepository.findByKeys(listing.platformId, keys);
      for (const mapping of mappings) {
        suggestions.set(
          `${mapping.externalCategoryId}:${mapping.externalTypeId}`,
          mapping.internalCategoryId,
        );
      }
    }

    const variants: OnboardContextVariantDto[] = rows.map((row) => {
      const attributes = readProductAttributes(row.mapping.rawData);
      const externalKey = readExternalCategoryKey(row.mapping.rawData);
      const suggested =
        externalKey === null
          ? null
          : (suggestions.get(`${externalKey.externalCategoryId}:${externalKey.externalTypeId}`) ??
            null);
      return {
        id: row.mapping.id,
        mappingStatus: row.mapping.mappingStatus,
        platformSkuId: row.mapping.platformSkuId,
        offerId: row.mapping.offerId,
        sellerSku: row.mapping.sellerSku,
        skuCode: row.skuCode,
        primaryImage: readImageUrl(row.mapping.rawData, 'primary_image'),
        colorImage: readImageUrl(row.mapping.rawData, 'color_image'),
        descriptionCategoryId: externalKey?.externalCategoryId ?? null,
        descriptionTypeId: externalKey?.externalTypeId ?? null,
        suggestedCategoryId: suggested,
        weightG: attributes?.weightG ?? null,
        lengthMm: attributes?.lengthMm ?? null,
        widthMm: attributes?.widthMm ?? null,
        heightMm: attributes?.heightMm ?? null,
      };
    });

    return {
      listingId,
      title: listing.title,
      variants,
    };
  }

  private async scheduleImageImport(mappingId: string, skuId: string): Promise<void> {
    try {
      const mapping = await this.repository.findMappingById(mappingId);
      const raw = mapping?.rawData ?? null;
      const url = readImageUrl(raw, 'color_image') ?? readImageUrl(raw, 'primary_image');
      await this.skuImageImport.scheduleFromOnboard(skuId, url);
    } catch {
      // Never let the optional image path mask a successful onboarding.
    }
  }

  private toResponse(listingId: string, outcome: OnboardingOutcome): ListingOnboardResponseDto {
    return {
      listingId,
      mappingId: outcome.mapping.id,
      mappingStatus: outcome.mapping.mappingStatus,
      sku: {
        id: outcome.sku.id,
        skuCode: outcome.sku.skuCode,
        nameZh: outcome.sku.nameZh,
      },
      barcode: outcome.barcode === null ? null : outcome.barcode.barcode,
    };
  }
}

/** Reads (description_category_id, type_id) from the flat v3 raw_data. */
function readExternalCategoryKey(
  rawData: Record<string, unknown> | null,
): { externalCategoryId: string; externalTypeId: string } | null {
  if (rawData === null) {
    return null;
  }
  const categoryId = rawData['description_category_id'];
  const typeId = rawData['type_id'];
  if (
    (typeof categoryId !== 'number' && typeof categoryId !== 'string') ||
    (typeof typeId !== 'number' && typeof typeId !== 'string')
  ) {
    return null;
  }
  return { externalCategoryId: String(categoryId), externalTypeId: String(typeId) };
}

/**
 * Reads the v4 enrichment payload (T5) and normalizes units into the
 * internal convention (integer mm / grams). Unknown dimension units are
 * treated as absent - the dialog leaves the field empty rather than
 * guessing a conversion.
 */
function readProductAttributes(rawData: Record<string, unknown> | null): {
  weightG: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
} | null {
  const attributes = rawData?.['product_attributes'];
  if (typeof attributes !== 'object' || attributes === null) {
    return null;
  }
  const payload = attributes as Record<string, unknown>;
  const dimensionUnit =
    typeof payload['dimension_unit'] === 'string' ? payload['dimension_unit'] : '';
  const dimensionFactor =
    dimensionUnit === 'mm' ? 1 : dimensionUnit === 'cm' ? 10 : dimensionUnit === 'in' ? 25.4 : null;
  const weightUnit = typeof payload['weight_unit'] === 'string' ? payload['weight_unit'] : '';
  const weightFactor =
    weightUnit === 'g' || weightUnit === 'г'
      ? 1
      : weightUnit === 'kg' || weightUnit === 'кг'
        ? 1000
        : null;
  const toNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;
  const lengthMm =
    dimensionFactor === null ? null : scale(toNumber(payload['depth']), dimensionFactor);
  const widthMm =
    dimensionFactor === null ? null : scale(toNumber(payload['width']), dimensionFactor);
  const heightMm =
    dimensionFactor === null ? null : scale(toNumber(payload['height']), dimensionFactor);
  const weightG = weightFactor === null ? null : scale(toNumber(payload['weight']), weightFactor);
  return {
    weightG,
    // All-or-none: partial dims are dropped (volume must stay computable).
    lengthMm: lengthMm !== null && widthMm !== null && heightMm !== null ? lengthMm : null,
    widthMm: lengthMm !== null && widthMm !== null && heightMm !== null ? widthMm : null,
    heightMm: lengthMm !== null && widthMm !== null && heightMm !== null ? heightMm : null,
  };
}

function scale(value: number | null, factor: number): number | null {
  if (value === null) {
    return null;
  }
  return Math.round(value * factor);
}

/**
 * Real OZON v3 data (verified 2026-09-14 on all 1324 synced rows): the image
 * fields arrive as single-element JSON ARRAYS ("url"), although the spec
 * declares plain strings. Accept both shapes; anything else is "absent".
 */
function readImageUrl(rawData: Record<string, unknown> | null, key: string): string | null {
  const value = rawData?.[key];
  if (typeof value === 'string' && value !== '') {
    return value;
  }
  if (Array.isArray(value)) {
    const first: unknown = value[0];
    if (typeof first === 'string' && first !== '') {
      return first;
    }
  }
  return null;
}
