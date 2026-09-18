import { Injectable } from '@nestjs/common';
import { PlatformLabelFile, PlatformShipmentPreparation } from '@wcies/platform-contracts';
import { parseYxAuth } from './yandex.adapter';
import { YandexClient, YxAuth, YxRawResponse } from './yandex.client';
import { YxOrder } from './types/api.types';
import { DomainError } from '../../../common/errors/domain.error';
import { PlatformApiError } from '../platform-error';
import { AppLoggerService } from '../../../common/logger/app-logger.service';

/**
 * Yandex Market order-lifecycle vocabulary for the fulfillment flow
 * (docs/yandex-partner-api-openapi.json: OrderStatusType / OrderSubstatusType,
 * 2026-09-18). The verified SELLER transition is
 * `PROCESSING/STARTED -> PROCESSING/READY_TO_SHIP`; everything beyond that is
 * platform-driven and must not be written by us.
 */
const STATUS_PROCESSING = 'PROCESSING';
const SUBSTATUS_STARTED = 'STARTED';
const SUBSTATUS_READY_TO_SHIP = 'READY_TO_SHIP';

/** Statuses that mean the seller's preparation step is over or moot. */
const YX_PREPARED_STATUSES: ReadonlySet<string> = new Set([
  STATUS_PROCESSING, // incl. every further substatus (SHIPPED, PACKAGING, ...)
  'DELIVERY',
  'PICKUP',
  'DELIVERED',
]);

/**
 * Label page layout. A9_HORIZONTALLY is 58x40mm - the same thermal-label size
 * WB's sticker API is called with, so one printer handles both platforms.
 */
const LABEL_FORMAT = 'A9_HORIZONTALLY';

/**
 * Yandex outbound-shipment operations (2026-09-18 order fulfillment flow).
 *
 * Like OzonShipmentService it is a thin platform-facing service: transport and
 * platform semantics only, no WCIES repositories, no business state. The
 * campaign identity ({businessId, campaignId}) is resolved by the adapter and
 * passed in, because it needs the credential + campaigns API.
 *
 * IDEMPOTENCY: the order is READ first. A `READY_TO_SHIP` order (or any order
 * already past the seller's preparation step) produces NO write.
 */
@Injectable()
export class YandexShipmentService {
  constructor(
    private readonly client: YandexClient,
    private readonly logger: AppLoggerService,
  ) {}

  async prepareShipment(
    context: { storeId: string; credential: Readonly<Record<string, unknown>> },
    order: { platformOrderId: string },
    identity: { businessId: string; campaignId: string },
  ): Promise<PlatformShipmentPreparation> {
    const auth = parseYxAuth(context.credential, context.storeId);
    const orderId = parseYxOrderId(order.platformOrderId);

    const before = await this.readOrder(auth, context.storeId, identity, orderId);
    if (before === undefined || before.status === undefined) {
      throw new YxOrderNotPreparableError('Yandex 未返回该订单的当前状态，无法发货', {
        platformOrderId: order.platformOrderId,
      });
    }
    const outcome = classify(before);

    if (outcome === 'PREPARED') {
      return {
        platformOrderId: order.platformOrderId,
        trackingNumber: readTrackCode(before),
        platformStatus: before.status,
        alreadyPrepared: true,
      };
    }
    if (outcome === 'BLOCKED') {
      throw new YxOrderNotPreparableError(
        `Yandex 订单当前状态（${before.status}${
          before.substatus === undefined ? '' : `/${before.substatus}`
        }）不允许发货`,
        {
          platformOrderId: order.platformOrderId,
          status: before.status,
          substatus: before.substatus ?? null,
        },
      );
    }

    // The one verified seller transition (vendor docs §updateOrderStatus).
    await this.client.updateOrderStatus(auth, context.storeId, {
      campaignId: identity.campaignId,
      orderId: String(orderId),
      status: STATUS_PROCESSING,
      substatus: SUBSTATUS_READY_TO_SHIP,
    });

    const after = (await this.readOrder(auth, context.storeId, identity, orderId)) ?? before;
    this.logger.log(
      `yandex order readied store=${context.storeId} order=${orderId} ` +
        `status=${after.status ?? '?'}/${after.substatus ?? '?'}`,
      'YandexShipmentService',
    );
    return {
      platformOrderId: order.platformOrderId,
      trackingNumber: readTrackCode(after),
      platformStatus: after.status ?? STATUS_PROCESSING,
      alreadyPrepared: false,
    };
  }

  /**
   * Fetches the order's label PDF (面单). Yandex generates it once the order
   * is `READY_TO_SHIP`; before that the endpoint errors, which surfaces as
   * "label not ready" (null) rather than a hard failure.
   */
  async fetchShippingLabel(
    context: { storeId: string; credential: Readonly<Record<string, unknown>> },
    order: { platformOrderId: string },
    identity: { businessId: string; campaignId: string },
  ): Promise<PlatformLabelFile | null> {
    const auth = parseYxAuth(context.credential, context.storeId);
    const orderId = parseYxOrderId(order.platformOrderId);

    let response: YxRawResponse;
    try {
      response = await this.client.orderLabels(auth, context.storeId, {
        campaignId: identity.campaignId,
        orderId: String(orderId),
        format: LABEL_FORMAT,
      });
    } catch (error: unknown) {
      if (error instanceof PlatformApiError && isLabelNotReady(error)) {
        this.logger.warn(
          `yandex label not ready store=${context.storeId} order=${orderId}`,
          'YandexShipmentService',
        );
        return null;
      }
      throw error;
    }
    return decodeLabelResponse(response, order.platformOrderId);
  }

  /** Targeted re-read of one order (also the post-write confirmation). */
  private async readOrder(
    auth: YxAuth,
    storeId: string,
    identity: { businessId: string; campaignId: string },
    orderId: number,
  ): Promise<YxOrder | undefined> {
    const response = await this.client.businessOrders(auth, storeId, {
      businessId: identity.businessId,
      limit: 50,
      body: { orderIds: [orderId] },
    });
    return (response.orders ?? []).find((row) => String(row.orderId ?? '') === String(orderId));
  }
}

// ---------------------------------------------------------------------------

type PrepareOutcome = 'PREPARED' | 'CAN_PREPARE' | 'BLOCKED';

/**
 * Decides what the seller may still do. `PROCESSING` counts as PREPARED for
 * ANY substatus beyond STARTED: the platform may move the order on itself
 * (SHIPPED, PACKAGING, ...) and writing READY_TO_SHIP then would be a
 * backwards transition.
 */
function classify(order: YxOrder): PrepareOutcome {
  const status = order.status ?? '';
  if (YX_PREPARED_STATUSES.has(status) && status !== STATUS_PROCESSING) {
    return 'PREPARED';
  }
  if (status === STATUS_PROCESSING) {
    return order.substatus === SUBSTATUS_STARTED ? 'CAN_PREPARE' : 'PREPARED';
  }
  // Everything else (CANCELLED / PENDING / UNPAID / unknown) is blocked -
  // reported, never guessed (AGENTS.md §88).
  return 'BLOCKED';
}

/**
 * The order's delivery tracking code when the platform has assigned one
 * (`delivery.tracks[]`); absent while the order is still being prepared.
 */
function readTrackCode(order: YxOrder): string | null {
  const tracks = order.delivery?.tracks;
  if (!Array.isArray(tracks)) {
    return null;
  }
  for (const track of tracks) {
    const code = (track as Record<string, unknown>)['trackCode'];
    if (typeof code === 'string' && code.trim() !== '') {
      return code.trim();
    }
  }
  return null;
}

/**
 * Decodes the label response. The spec declares a clean
 * `application/pdf` binary; a JSON error body (label not ready) is handled
 * upstream, so anything that reaches here is treated as the file itself.
 */
function decodeLabelResponse(
  response: YxRawResponse,
  platformOrderId: string,
): PlatformLabelFile | null {
  const contentType = (response.contentType ?? '').toLowerCase();
  const looksJson = contentType.includes('json') || response.text.trimStart().startsWith('{');
  if (looksJson) {
    return null; // an error body, not a PDF
  }
  if (response.bytes.byteLength === 0) {
    return null;
  }
  return {
    fileName: `yandex-label-${platformOrderId}.pdf`,
    mimeType: contentType === '' ? 'application/pdf' : (response.contentType as string),
    bytes: response.bytes,
  };
}

/** "Not generated yet" answers that mean retry later, not a hard failure. */
function isLabelNotReady(error: PlatformApiError): boolean {
  const status = error.platformError.httpStatus;
  return status === 400 || status === 404 || status === 409;
}

/** Yandex order ids are numeric on the wire; our platform_order_id is a string. */
export function parseYxOrderId(platformOrderId: string): number {
  if (!/^\d{1,18}$/.test(platformOrderId)) {
    throw new YxOrderNotPreparableError('Yandex 订单号不是有效的数字 ID，无法调用发货接口', {
      platformOrderId,
    });
  }
  return Number(platformOrderId);
}

/** Yandex order cannot be prepared in its current state. */
export class YxOrderNotPreparableError extends DomainError {
  readonly code = 'YX_ORDER_NOT_PREPARABLE';
  readonly httpStatus = 409;

  constructor(message: string, details: Record<string, unknown>) {
    super(message, details);
  }
}
