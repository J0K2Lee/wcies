import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DomainError } from '../../../common/errors/domain.error';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { BarcodeService } from '../../product/services/barcode.service';
import { ProductService } from '../../product/services/product.service';
import { SkuService } from '../../product/services/sku.service';
import {
  ListingNotFoundError,
  ListingSkuMappingInvalidStateError,
  ListingSkuMappingNotFoundError,
} from '../errors/listing-errors';
import { ListingRepository } from '../repositories/listing.repository';
import { ListingService } from './listing.service';
import { ListingOnboardRequestDto, ListingOnboardResponseDto } from '../dto/listing.dto';

const PRODUCT_ENTITY = 'PRODUCT';
const SKU_ENTITY = 'SKU';
const BARCODE_ENTITY = 'SKU_BARCODE';
const MAPPING_ENTITY = 'PLATFORM_LISTING_SKU';

/**
 * Structural views of what the product module's InTx participants return.
 * Entity CLASSES stay inside the product module (AGENTS.md §9 / arch Rule 4) -
 * the orchestrator only consumes these fields.
 */
interface OnboardedProduct {
  id: string;
  productCode: string;
  nameZh: string;
}

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
  product: OnboardedProduct;
  sku: OnboardedSku;
  barcode: OnboardedBarcode | null;
  mapping: { id: string; mappingStatus: string };
}

export class ListingOnboardNameRequiredError extends DomainError {
  readonly code = 'LISTING_ONBOARD_NAME_REQUIRED';
  readonly httpStatus = 422;
  constructor() {
    super('商品名/SKU 名不能为空（该 Listing 无标题，请手工填写名称）', {});
  }
}

/**
 * Sprint 8 T1 - quick onboarding from an unmapped listing variant.
 *
 * Compresses "create Product -> create SKU -> (optional) internal barcode ->
 * map the variant" into ONE action. The writes span the product and listing
 * modules, so THIS service owns the transaction boundary and the modules
 * participate through their public *InTx methods (AGENTS.md §7/§9 - no
 * cross-module repository imports). Any failure rolls everything back: a
 * "SKU created but never mapped" half-product must not exist.
 *
 * Quick-onboarding may only start from an UNMAPPED variant row - a mapped
 * row keeps its binding until explicitly changed (planning §T1.6).
 * Operation logs are written AFTER the commit, so a rollback leaves no
 * audit orphans.
 */
@Injectable()
export class ListingOnboardingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly repository: ListingRepository,
    private readonly productService: ProductService,
    private readonly skuService: SkuService,
    private readonly barcodeService: BarcodeService,
    private readonly listingService: ListingService,
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
    if (mapping.skuId !== null) {
      throw new ListingSkuMappingInvalidStateError(mappingId, 'already mapped');
    }

    const fallbackName = listing.title?.trim() ?? '';
    const productName = (dto.productNameZh ?? '').trim() || fallbackName;
    const skuName = (dto.skuNameZh ?? '').trim() || fallbackName;
    if (productName === '' || skuName === '') {
      throw new ListingOnboardNameRequiredError();
    }

    const generateBarcode = dto.generateBarcode ?? true;

    const outcome: OnboardingOutcome = await this.dataSource.transaction(async (manager) => {
      const product = await this.productService.createForOnboardingInTx(
        manager,
        { nameZh: productName },
        operator,
      );
      const sku = await this.skuService.createForOnboardingInTx(manager, {
        productId: product.id,
        nameZh: skuName,
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
      return { product, sku, barcode, mapping: updatedMapping };
    });

    // Post-commit audit trail (best-effort by design, OperationLogService).
    await this.operationLog.record({
      entityType: PRODUCT_ENTITY,
      entityId: outcome.product.id,
      entityCode: outcome.product.productCode,
      action: 'CREATE',
      changes: {
        productCode: { from: null, to: outcome.product.productCode },
        source: { from: null, to: `LISTING_ONBOARD:${listingId}` },
      },
      operator,
    });
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

    return this.toResponse(listingId, outcome);
  }

  private toResponse(listingId: string, outcome: OnboardingOutcome): ListingOnboardResponseDto {
    return {
      listingId,
      mappingId: outcome.mapping.id,
      mappingStatus: outcome.mapping.mappingStatus,
      product: {
        id: outcome.product.id,
        productCode: outcome.product.productCode,
        nameZh: outcome.product.nameZh,
      },
      sku: {
        id: outcome.sku.id,
        skuCode: outcome.sku.skuCode,
        nameZh: outcome.sku.nameZh,
      },
      barcode: outcome.barcode === null ? null : outcome.barcode.barcode,
    };
  }
}
