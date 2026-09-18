import { Injectable } from '@nestjs/common';
import { PlatformLabelFile, PlatformShipmentPreparation } from '@wcies/platform-contracts';
import { parseOzonAuth } from './ozon-auth';
import { OzonClient, OzonRawResponse } from './ozon.client';
import {
  OzonFbsPosting,
  OzonPackageLabelResponse,
  OzonPostingProduct,
  OzonShipPackage,
} from './types/api.types';
import { PlatformApiError } from '../platform-error';
import { DomainError } from '../../../common/errors/domain.error';
import { AppLoggerService } from '../../../common/logger/app-logger.service';

/**
 * OZON posting statuses meaning the order has ALREADY been accepted for
 * dispatch (组包 done). Verified against the v3 English spec vocabulary and
 * corroborated by real account data (2026-09-18): of 197 synced postings,
 * every `awaiting_deliver` / `delivering` row carries a `tracking_number`
 * while every `awaiting_packaging` row has none - i.e. OZON assigns the
 * waybill exactly at assembly time. See docs/integrations/ozon.md.
 */
const OZON_ASSEMBLED_STATUSES: ReadonlySet<string> = new Set([
  'awaiting_deliver',
  'delivering',
  'driver_pickup',
  'acceptance_in_progress',
  'delivered',
]);

/**
 * Statuses we will attempt to assemble. `awaiting_packaging` is the one
 * verified shippable state; `available_actions` (`ship` / `ship_async`) is
 * used as a corroborating signal so unlisted-but-explicitly-shippable
 * postings are not blocked. Anything else is reported, never guessed
 * (AGENTS.md §88).
 */
const OZON_FALLBACK_SHIPPABLE_STATUSES: ReadonlySet<string> = new Set(['awaiting_packaging']);

/** `available_actions` values that mean "the platform can assemble this now". */
const SHIP_ACTION_HINTS: ReadonlySet<string> = new Set(['ship', 'ship_async']);
/** `available_actions` values that mean "assembly is already running". */
const SHIP_IN_PROGRESS_HINTS: ReadonlySet<string> = new Set([
  'ship_async_in_process',
  'ship_async_retry',
]);

/**
 * OZON order fulfillment operations (2026-09-18 order shipping flow).
 *
 * Owns the platform-side WRITE for this flow - 组包 (`/v4/posting/fbs/ship`)
 * - plus the label fetch (`/v2/posting/fbs/package-label`). Like
 * OzonWarehouseService it is a thin platform-facing service: transport and
 * platform semantics only, no WCIES repositories, no business state.
 *
 * IDEMPOTENCY: OZON treats an already-assembled posting as a repeat-call
 * error, so `prepareShipment` first READS the posting and returns
 * `alreadyPrepared` without writing when the platform has already accepted
 * the order. That makes the caller's "ensure prepared" step safe to call on
 * every 发货 click.
 *
 * T0: the ship request/response and the label body encoding are spec-derived
 * but NOT yet run against a live account (AGENTS.md §92 requires the owner's
 * explicit approval for that). See docs/integrations/ozon.md 平台写操作.
 */
@Injectable()
export class OzonShipmentService {
  constructor(
    private readonly client: OzonClient,
    private readonly logger: AppLoggerService,
  ) {}

  async prepareShipment(
    context: { storeId: string; credential: Readonly<Record<string, unknown>> },
    order: { platformOrderId: string },
  ): Promise<PlatformShipmentPreparation> {
    const auth = parseOzonAuth(context.credential, context.storeId);
    const postingNumber = order.platformOrderId;

    const before = await this.readPosting(auth, context.storeId, postingNumber);
    if (isAssembled(before)) {
      return {
        platformOrderId: postingNumber,
        trackingNumber: readTrackingNumber(before),
        platformStatus: before.status,
        alreadyPrepared: true,
      };
    }

    const decision = classify(before);
    if (decision === 'IN_PROGRESS') {
      throw new OzonOrderNotReadyError('OZON 正在组包该订单，请稍后重试', {
        postingNumber,
        platformStatus: before.status,
        reason: 'ship_async_in_process',
      });
    }
    if (decision === 'BLOCKED') {
      throw new OzonOrderNotReadyError(`OZON 订单当前状态（${before.status}）不允许组包`, {
        postingNumber,
        platformStatus: before.status,
      });
    }

    const packages = buildPackages(before, postingNumber);
    await this.shipIgnoringAlreadyShipped(auth, context.storeId, postingNumber, packages);

    // The spec is explicit that a 200 does NOT prove assembly - the posting
    // must be re-read and, on `substatus = ship_failed`, the assembly retried.
    const after = await this.readPosting(auth, context.storeId, postingNumber);
    if (!isAssembled(after)) {
      throw new OzonAssemblyNotConfirmedError({
        postingNumber,
        platformStatus: after.status,
        substatus: after.substatus ?? null,
      });
    }
    this.logger.log(
      `ozon posting assembled store=${context.storeId} posting=${postingNumber} status=${after.status}`,
      'OzonShipmentService',
    );
    return {
      platformOrderId: postingNumber,
      trackingNumber: readTrackingNumber(after),
      platformStatus: after.status,
      alreadyPrepared: false,
    };
  }

  /**
   * Fetches the shipping label PDF. OZON only serves labels for
   * `awaiting_deliver` postings, so the caller must have prepared the
   * shipment first. Returns null when the platform answers that the label is
   * not generated yet (a retryable, non-fatal condition).
   */
  async fetchShippingLabel(
    context: { storeId: string; credential: Readonly<Record<string, unknown>> },
    order: { platformOrderId: string },
  ): Promise<PlatformLabelFile | null> {
    const auth = parseOzonAuth(context.credential, context.storeId);
    const postingNumber = order.platformOrderId;

    let response: OzonRawResponse;
    try {
      response = await this.client.packageLabel(auth, context.storeId, [postingNumber]);
    } catch (error: unknown) {
      // Documented label errors that mean "not ready yet" rather than a real
      // failure (spec error table for /v2/posting/fbs/package-label).
      if (error instanceof PlatformApiError && isLabelNotReady(error.message)) {
        this.logger.warn(
          `ozon label not ready store=${context.storeId} posting=${postingNumber}`,
          'OzonShipmentService',
        );
        return null;
      }
      throw error;
    }
    return decodeLabelResponse(response, postingNumber);
  }

  // -----------------------------------------------------------------------

  private async readPosting(
    auth: ReturnType<typeof parseOzonAuth>,
    storeId: string,
    postingNumber: string,
  ): Promise<OzonFbsPosting> {
    const response = await this.client.fbsPostingGet(auth, storeId, postingNumber);
    const posting = response?.result;
    if (typeof posting?.posting_number !== 'string' || typeof posting?.status !== 'string') {
      throw new OzonOrderNotReadyError('OZON 未返回该订单的有效发货单信息', {
        postingNumber,
      });
    }
    return posting;
  }

  /**
   * Sends the assembly request, tolerating the platform's "already shipped"
   * answer as success: the caller re-reads the posting right after, so a
   * concurrent/repeated assembly still converges to the platform facts.
   */
  private async shipIgnoringAlreadyShipped(
    auth: ReturnType<typeof parseOzonAuth>,
    storeId: string,
    postingNumber: string,
    packages: readonly OzonShipPackage[],
  ): Promise<void> {
    try {
      await this.client.fbsPostingShip(auth, storeId, { postingNumber, packages });
    } catch (error: unknown) {
      if (error instanceof PlatformApiError && isAlreadyShipped(error.message)) {
        this.logger.warn(
          `ozon posting already assembled store=${storeId} posting=${postingNumber}`,
          'OzonShipmentService',
        );
        return;
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------

type PrepareDecision = 'ASSEMBLED' | 'CAN_SHIP' | 'IN_PROGRESS' | 'BLOCKED';

function isAssembled(posting: OzonFbsPosting): boolean {
  return OZON_ASSEMBLED_STATUSES.has(posting.status);
}

/**
 * Decides whether the posting may be assembled. `available_actions` (when the
 * platform provides it) wins over our status list so a posting the platform
 * itself advertises as shippable is never blocked by an incomplete local
 * vocabulary.
 */
function classify(posting: OzonFbsPosting): PrepareDecision {
  const actions = readActions(posting);
  if (actions.some((action) => SHIP_IN_PROGRESS_HINTS.has(action))) {
    return 'IN_PROGRESS';
  }
  if (actions.some((action) => SHIP_ACTION_HINTS.has(action))) {
    return 'CAN_SHIP';
  }
  if (posting.status === 'cancelled' || posting.status === 'cancelled_from_split_pending') {
    return 'BLOCKED';
  }
  return OZON_FALLBACK_SHIPPABLE_STATUSES.has(posting.status) ? 'CAN_SHIP' : 'BLOCKED';
}

/**
 * Reads a posting array field defensively. The narrowing goes through
 * `unknown` on purpose: `Array.isArray` on a `readonly T[]` yields an
 * `any[]` intersection that would silently poison every downstream access.
 */
function readActions(posting: OzonFbsPosting): readonly string[] {
  const raw: unknown = posting.available_actions;
  return Array.isArray(raw) ? (raw as readonly string[]) : [];
}

function readProducts(posting: OzonFbsPosting): readonly OzonPostingProduct[] {
  const raw: unknown = posting.products;
  return Array.isArray(raw) ? (raw as readonly OzonPostingProduct[]) : [];
}

/**
 * Builds the ship request from the posting READ FROM THE PLATFORM - never from
 * local rows - so the parcel contents always match what OZON expects. Every
 * product of the posting goes into a single package ("one order = one
 * parcel"), which is what the fulfilment flow ships.
 */
function buildPackages(posting: OzonFbsPosting, postingNumber: string): OzonShipPackage[] {
  const products = readProducts(posting);
  const mapped = products.map((product) => {
    const quantity = product.quantity;
    if (!Number.isInteger(product.sku) || product.sku <= 0) {
      throw new OzonOrderNotReadyError('该发货单存在无有效 SKU 的商品行，无法组包', {
        postingNumber,
        sku: product.sku,
      });
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new OzonOrderNotReadyError('该发货单存在无效数量，无法组包', {
        postingNumber,
        sku: product.sku,
        quantity,
      });
    }
    return { product_id: product.sku, quantity };
  });
  if (mapped.length === 0) {
    throw new OzonOrderNotReadyError('该发货单没有商品行，无法组包', { postingNumber });
  }
  return [{ products: mapped }];
}

function readTrackingNumber(posting: OzonFbsPosting): string | null {
  const value = posting.tracking_number;
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Decodes the label response. The spec declares `application/pdf` yet
 * documents a JSON envelope carrying base64 `file_content`; the live shape is
 * a T0 item, so BOTH are handled by inspecting the actual Content-Type.
 * Returns null when a JSON body carries no usable content (label not ready).
 */
function decodeLabelResponse(
  response: OzonRawResponse,
  postingNumber: string,
): PlatformLabelFile | null {
  const contentType = (response.contentType ?? '').toLowerCase();
  const looksJson = contentType.includes('json') || response.text.trimStart().startsWith('{');
  if (!looksJson) {
    if (response.bytes.byteLength === 0) {
      return null;
    }
    return {
      fileName: `ozon-label-${postingNumber}.pdf`,
      mimeType: contentType === '' ? 'application/pdf' : (response.contentType as string),
      bytes: response.bytes,
    };
  }

  let parsed: OzonPackageLabelResponse;
  try {
    parsed = JSON.parse(response.text) as OzonPackageLabelResponse;
  } catch {
    return null;
  }
  const base64 = parsed.file_content;
  if (typeof base64 !== 'string' || base64 === '') {
    return null;
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.byteLength === 0) {
    return null;
  }
  return {
    fileName:
      typeof parsed.file_name === 'string' && parsed.file_name !== ''
        ? parsed.file_name
        : `ozon-label-${postingNumber}.pdf`,
    mimeType:
      typeof parsed.content_type === 'string' && parsed.content_type !== ''
        ? parsed.content_type
        : 'application/pdf',
    bytes: new Uint8Array(bytes),
  };
}

/** Documented label errors meaning "try again later", not a real failure. */
function isLabelNotReady(message: string): boolean {
  return (
    message.includes("aren't ready") ||
    message.includes('not ready') ||
    message.includes('label not allowed')
  );
}

/** Assembly already done - the caller re-reads and converges on the facts. */
function isAlreadyShipped(message: string): boolean {
  return message.includes('POSTING_ALREADY_SHIPPED') || message.includes('HAS_INCORRECT_STATUS');
}

/** OZON order cannot be prepared in its current platform state. */
export class OzonOrderNotReadyError extends DomainError {
  readonly code = 'OZON_ORDER_NOT_PREPARABLE';
  readonly httpStatus = 409;

  constructor(message: string, details: Record<string, unknown>) {
    super(message, details);
  }
}

/** The platform accepted the request but the posting is not assembled yet. */
export class OzonAssemblyNotConfirmedError extends DomainError {
  readonly code = 'PLATFORM_SHIP_NOT_CONFIRMED';
  readonly httpStatus = 502;

  constructor(details: {
    postingNumber: string;
    platformStatus: string;
    substatus: string | null;
  }) {
    super(
      `OZON 未确认组包成功（当前状态 ${details.platformStatus}${
        details.substatus === null ? '' : `/${details.substatus}`
      }），请稍后重试`,
      { ...details },
    );
  }
}
